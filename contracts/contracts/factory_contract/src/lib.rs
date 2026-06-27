/*
  factory_contract - Fábrica de contratos de evento

  Este contrato implementa el patrón Factory: en vez de tener un solo contrato
  que maneje todos los eventos, la factory crea un contrato independiente por
  cada evento. Esto tiene varias ventajas:

  1. Aislamiento: si un contrato de evento tiene un problema, no afecta a los
     demás. Cada evento tiene su propio storage y su propio ciclo de vida
  2. Escalabilidad: el storage de Soroban tiene límites por contrato. Con un
     contrato por evento, cada uno tiene su propio espacio
  3. Auditabilidad: se puede verificar un evento específico sin tener que
     recorrer datos de otros eventos

  Cómo funciona el deploy programático:
  En Soroban, un contrato puede crear (deploy) otros contratos. El proceso es:
  1. Se compila el event_contract a un archivo WASM (WebAssembly)
  2. Se sube ese WASM a la red Stellar y se obtiene un hash único de 32 bytes
  3. La factory guarda ese hash y cuando necesita crear un nuevo evento,
     usa "env.deployer().deploy_v2(hash, args)" para instanciar el contrato

  "#[cfg(test)]" y "#[cfg(not(test))]":
  Rust permite compilar código condicionalmente. Usamos esto porque el
  entorno de testing de Soroban no soporta deploy real de contratos
  En los tests, simulamos el deploy registrando el contrato manualmente
  En producción, se hace el deploy real con "deploy_v2"
*/

#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, BytesN, Env};
use event_contract::ContratoEventoClient;

// Base para calcular porcentajes de comisión. Usa "u32" (a diferencia del
// event_contract que usa "i128") porque aquí solo se usa para validación,
// no para cálculos de pagos
const BASE_PORCENTAJE: u32 = 100;

// TIPOS

/*
  Configuración necesaria para crear un nuevo contrato de evento
  Este struct empaqueta todos los parámetros que definen a un evento
  Se pasa como un solo argumento a "crear_evento_contrato" en vez de
  pasar 7+ parámetros individuales

  Campos:
  - "id_evento": Identificador único del evento. No puede repetirse
    entre contratos creados por esta factory
  - "organizador": Dirección del organizador del evento. Esta dirección
    será la única que pueda crear boletos dentro del event_contract
  - "token_pago": Dirección del contrato del token que se usará para
    pagos (ej: USDC, XLM wrapeado, etc)
  - "comision_organizador": Porcentaje (0-99) que el organizador recibe
    de cada reventa. Ejemplo: 20 = 20%
  - "comision_plataforma": Porcentaje (0-99) que la plataforma recibe
    de cada reventa
  - "wallet_organizador": Dirección donde el organizador recibe pagos
    Puede ser distinta de "organizador" (ej: una cuenta de tesorería)
  - "wallet_plataforma": Dirección donde la plataforma recibe comisiones
  - "capacidad_total": Número máximo de boletos que puede tener el evento
    Se valida que sea > 0 pero el contrato hijo no la aplica todavía
    (queda para el off-chain)
*/
#[derive(Clone)]
#[contracttype]
pub struct ConfiguracionEvento {
    pub id_evento: u32,
    pub organizador: Address,
    pub token_pago: Address,
    pub comision_organizador: u32,
    pub comision_plataforma: u32,
    pub wallet_organizador: Address,
    pub wallet_plataforma: Address,
    pub capacidad_total: u32,
}

/*
  Claves para el storage de la factory
  Cada variante define una "dirección" en la base de datos del contrato:

  - Administrador: Guarda la dirección del admin de la factory
    Solo esta dirección puede crear nuevos eventos
  - ContadorEventos: Número total de eventos creados. Se usa como métrica
  - HashWasmEvento: El hash del código WASM compilado del event_contract
    Se configura después del deploy y se usa para crear nuevas instancias
  - ContratoEvento(id): Mapea un id_evento a la dirección del contrato
    que lo maneja. Permite buscar "dónde vive el evento 42"
  - ContratoRegistrado(address): Mapeo inverso: registra que una dirección
    de contrato ya fue usada. Previene que se registre la misma dirección
    para dos eventos distintos
*/
#[derive(Clone)]
#[contracttype]
pub enum ClaveDato {
    Administrador,
    ContadorEventos,
    HashWasmEvento,
    ContratoEvento(u32),
    ContratoRegistrado(Address),
}

// Evento emitido cuando se crea exitosamente un nuevo contrato de evento
// El indexador off-chain escucha este evento para saber que hay un nuevo
// evento registrado y comenzar a indexar los eventos del contrato hijo
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EventoCreado {
    #[topic]
    pub id_evento: u32,
    pub organizador: Address,
    pub contrato_evento: Address,
    pub capacidad_total: u32,
}

// CONTRATO: FACTORY

#[contract]
pub struct FabricaBoletos;

#[contractimpl]
impl FabricaBoletos {

    // FUNCIONES INTERNAS

    // Lee la dirección del administrador desde el storage
    // Si no existe, el contrato no fue inicializado y falla con panic
    fn obtener_administrador(entorno: &Env) -> Address {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::Administrador)
            .expect("not_init")
    }

    // Verifica que el hash WASM del event_contract esté configurado
    // Sin este hash, no se puede crear nuevos contratos de evento
    fn validar_wasm_hash_configurado(entorno: &Env) {
        if !entorno.storage().instance().has(&ClaveDato::HashWasmEvento) {
            panic!("event_wasm_hash_not_set");
        }
    }

    /*
      Genera un "salt" (semilla) único para el deploy del contrato
      En Soroban, cuando un contrato despliega otro contrato, necesita un
      salt de 32 bytes para generar una dirección determinista. El salt
      asegura que cada evento tenga una dirección de contrato única y
      predecible (se puede calcular de antemano sabiendo el id_evento)

      Usamos los primeros 4 bytes del salt para el id_evento en formato
      big-endian (byte más significativo primero) y el resto con ceros

      "#[cfg(not(test))]" significa que esta función solo existe en el
      código de producción, no en los tests
    */
    #[cfg(not(test))]
    fn crear_salt_evento(entorno: &Env, id_evento: u32) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[..4].copy_from_slice(&id_evento.to_be_bytes());
        BytesN::from_array(entorno, &bytes)
    }

    /*
      Despliega una nueva instancia del event_contract
      Esta función tiene dos implementaciones según el contexto:

      EN TESTS ("#[cfg(test)]"):
        No hace deploy real. El entorno de testing de Soroban no soporta
        "deploy_v2", así que recibimos la dirección de un contrato que ya
        fue registrado manualmente con "entorno.register(ContratoEvento, ())"
        Retorna esa dirección tal cual

      EN PRODUCCIÓN ("#[cfg(not(test))]"):
        Usa el deployer de Soroban para crear un contrato nuevo:
        1. Lee el hash WASM del event_contract del storage
        2. Genera un salt único basado en el id_evento
        3. Llama "deployer().with_current_contract(salt).deploy_v2(hash, ())"
           que crea el contrato en la blockchain y retorna su dirección

        "with_current_contract(salt)" significa que el nuevo contrato se
        despliega "bajo" la factory, con una dirección derivada del
        contrato actual + el salt
    */
    fn desplegar_contrato_evento(
        _entorno: &Env,
        id_evento: u32,
        direccion_evento_prueba: Address,
    ) -> Address {
        #[cfg(test)]
        {
            let _ = id_evento;
            direccion_evento_prueba
        }

        #[cfg(not(test))]
        {
            let _ = direccion_evento_prueba;
            let hash_wasm_evento: BytesN<32> = _entorno
                .storage()
                .instance()
                .get(&ClaveDato::HashWasmEvento)
                .expect("event_wasm_hash_not_set");
            let salt = Self::crear_salt_evento(_entorno, id_evento);
            _entorno
                .deployer()
                .with_current_contract(salt)
                .deploy_v2(hash_wasm_evento, ())
        }
    }

    /*
      Inicializa el contrato hijo (event_contract) recién desplegado
      Después de hacer el deploy del contrato, hay que configurarlo
      llamando su función "inicializar". Usamos "ContratoEventoClient"
      que es un cliente auto-generado por Soroban a partir del event_contract
      Este cliente permite llamar las funciones del event_contract desde
      la factory como si fueran funciones locales

      "as i128" convierte los porcentajes de "u32" a "i128" porque el
      event_contract espera comisiones como "i128" (para consistencia
      con los montos de tokens)
    */
    fn inicializar_contrato_evento(
        entorno: &Env,
        direccion_contrato_evento: &Address,
        configuracion: &ConfiguracionEvento,
    ) {
        let cliente_evento = ContratoEventoClient::new(entorno, direccion_contrato_evento);
        cliente_evento.inicializar(
            &configuracion.organizador,
            &configuracion.wallet_plataforma,
            &configuracion.token_pago,
            &(configuracion.comision_organizador as i128),
            &(configuracion.comision_plataforma as i128),
        );
    }

    // FUNCIONES PÚBLICAS

    /*
      Inicializa la factory con un administrador
      Se llama una sola vez después del deploy de la factory
      Define quién tiene permisos para crear nuevos eventos

      Entrada: "administrador" - Dirección que tendrá permisos de admin
      Panics: "already_init" si ya fue inicializada
      Seguridad: "administrador.require_auth()" verifica que el admin firmó
      la transacción
    */
    pub fn inicializar(entorno: Env, administrador: Address) {
        if entorno.storage().instance().has(&ClaveDato::Administrador) {
            panic!("already_init");
        }

        administrador.require_auth();

        entorno
            .storage()
            .instance()
            .set(&ClaveDato::Administrador, &administrador);
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::ContadorEventos, &0u32);
    }

    /*
      Crea un nuevo contrato de evento y lo registra en la factory
      Este es el flujo principal de la factory. Al llamar esta función:
      1. Valida permisos (admin y organizador deben firmar)
      2. Valida configuración (comisiones < 100%, capacidad > 0)
      3. Verifica que el id_evento no exista ya
      4. Despliega un nuevo event_contract en la blockchain
      5. Inicializa el contrato hijo con la configuración del evento
      6. Registra el mapeo id_evento -> dirección del contrato
      7. Emite evento "EventoCreado" para el indexador

      Entradas:
      - "configuracion": Struct con todos los parámetros del evento
      - "direccion_evento_prueba": Solo se usa en tests. En producción
        se ignora porque el contrato se despliega programáticamente

      Salida: Address del nuevo contrato de evento creado

      Panics: "fees_too_high", "invalid_capacity", "event_exists",
              "contract_already_registered"

      Seguridad: El administrador Y el organizador deben firmar la
      transacción. Esto implementa un modelo de doble autorización:
      el admin certifica que la factory lo permite, y el organizador
      certifica que acepta las condiciones
    */
    pub fn crear_evento_contrato(
        entorno: Env,
        configuracion: ConfiguracionEvento,
        direccion_evento_prueba: Address,
    ) -> Address {
        let administrador = Self::obtener_administrador(&entorno);
        administrador.require_auth();
        configuracion.organizador.require_auth();

        Self::validar_wasm_hash_configurado(&entorno);

        if configuracion.comision_organizador + configuracion.comision_plataforma >= BASE_PORCENTAJE {
            panic!("fees_too_high");
        }
        if configuracion.capacidad_total == 0 {
            panic!("invalid_capacity");
        }
        if entorno
            .storage()
            .instance()
            .has(&ClaveDato::ContratoEvento(configuracion.id_evento))
        {
            panic!("event_exists");
        }

        // Deploy del contrato hijo
        let direccion_contrato_evento = Self::desplegar_contrato_evento(
            &entorno,
            configuracion.id_evento,
            direccion_evento_prueba,
        );

        // Verificar que la dirección no fue usada antes
        if entorno
            .storage()
            .instance()
            .has(&ClaveDato::ContratoRegistrado(direccion_contrato_evento.clone()))
        {
            panic!("contract_already_registered");
        }

        // Inicializar el contrato hijo con la configuración del evento
        Self::inicializar_contrato_evento(&entorno, &direccion_contrato_evento, &configuracion);

        // Registrar mapeo id_evento -> dirección
        entorno.storage().instance().set(
            &ClaveDato::ContratoEvento(configuracion.id_evento),
            &direccion_contrato_evento,
        );
        // Registrar mapeo inverso dirección -> true (para evitar duplicados)
        entorno.storage().instance().set(
            &ClaveDato::ContratoRegistrado(direccion_contrato_evento.clone()),
            &true,
        );

        // Incrementar contador de eventos
        let contador_actual: u32 = entorno
            .storage()
            .instance()
            .get(&ClaveDato::ContadorEventos)
            .expect("not_init");
        let nuevo_contador = contador_actual + 1;
        entorno
            .storage()
            .instance()
            .set(&ClaveDato::ContadorEventos, &nuevo_contador);

        // Emitir evento para que el indexador lo detecte
        EventoCreado {
            id_evento: configuracion.id_evento,
            organizador: configuracion.organizador,
            contrato_evento: direccion_contrato_evento.clone(),
            capacidad_total: configuracion.capacidad_total,
        }
        .publish(&entorno);

        direccion_contrato_evento
    }

    /*
      Configura (o actualiza) el hash WASM del event_contract
      Después de compilar el event_contract y subirlo a la red con
      "stellar contract install", se obtiene un hash de 32 bytes. Ese
      hash se guarda aquí para que la factory sepa qué código desplegar
      cuando se crea un nuevo evento

      Se puede llamar múltiples veces si se actualiza el event_contract
      (los contratos existentes no se afectan, solo los nuevos)

      Entrada: "hash_wasm_evento" - Hash de 32 bytes del WASM compilado
      Seguridad: Solo el administrador puede configurar esto
    */
    pub fn configurar_wasm_evento(entorno: Env, hash_wasm_evento: BytesN<32>) {
        let administrador = Self::obtener_administrador(&entorno);
        administrador.require_auth();

        entorno
            .storage()
            .instance()
            .set(&ClaveDato::HashWasmEvento, &hash_wasm_evento);
    }

    // Obtiene el hash WASM configurado para el event_contract
    // Panics si no se ha configurado ningún hash WASM
    pub fn obtener_wasm_evento(entorno: Env) -> BytesN<32> {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::HashWasmEvento)
            .expect("event_wasm_hash_not_set")
    }

    // Obtiene la dirección del contrato de un evento específico
    // Entrada: "id_evento" - ID del evento
    // Salida: Address del event_contract que gestiona ese evento
    // Panics si no existe un evento con ese ID
    pub fn obtener_contrato_evento(entorno: Env, id_evento: u32) -> Address {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::ContratoEvento(id_evento))
            .expect("event_not_found")
    }

    // Retorna el número total de eventos creados por esta factory
    // Panics si la factory no fue inicializada
    pub fn obtener_contador_eventos(entorno: Env) -> u32 {
        entorno
            .storage()
            .instance()
            .get(&ClaveDato::ContadorEventos)
            .expect("not_init")
    }
}

#[cfg(test)]
mod test;
