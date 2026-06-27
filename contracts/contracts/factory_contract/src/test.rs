extern crate std;

use crate::{ConfiguracionEvento, FabricaBoletos, FabricaBoletosClient};
use event_contract::{ContratoEvento, ContratoEventoClient};
use soroban_sdk::{
    testutils::Address as _,
    token::Client as ClienteToken,
    Address, BytesN, Env,
};

// HELPERS

// Crea una configuración de evento con parámetros personalizables
fn crear_configuracion(
    entorno: &Env,
    id_evento: u32,
    com_org: u32,
    com_plat: u32,
    capacidad: u32,
) -> ConfiguracionEvento {
    ConfiguracionEvento {
        id_evento,
        organizador: Address::generate(entorno),
        token_pago: Address::generate(entorno),
        comision_organizador: com_org,
        comision_plataforma: com_plat,
        wallet_organizador: Address::generate(entorno),
        wallet_plataforma: Address::generate(entorno),
        capacidad_total: capacidad,
    }
}

/*
  Crea un entorno de prueba con la factory inicializada y un hash WASM configurado
  Retorna: (entorno, cliente_factory, administrador)
*/
fn configurar_fabrica<'a>() -> (Env, FabricaBoletosClient<'a>, Address) {
    let entorno = Env::default();
    entorno.mock_all_auths();

    let administrador = Address::generate(&entorno);
    let id_contrato = entorno.register(FabricaBoletos, ());
    let cliente = FabricaBoletosClient::new(&entorno, &id_contrato);

    cliente.inicializar(&administrador);

    let hash_evento = BytesN::from_array(&entorno, &[7u8; 32]);
    cliente.configurar_wasm_evento(&hash_evento);

    (entorno, cliente, administrador)
}

// Registra una instancia del event_contract en el entorno de prueba
fn registrar_contrato_evento(entorno: &Env) -> Address {
    entorno.register(ContratoEvento, ())
}

// TESTS: INICIALIZACIÓN

// Verifica que la factory se inicializa correctamente con contador en 0 y hash WASM configurado
#[test]
fn test_initialize_success() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    assert_eq!(cliente.obtener_contador_eventos(), 0);
    assert_eq!(cliente.obtener_wasm_evento(), BytesN::from_array(&entorno, &[7u8; 32]));
}

// Actualiza el hash WASM y verifica que se guardó correctamente
#[test]
fn test_update_wasm_hash_success() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let nuevo_hash = BytesN::from_array(&entorno, &[9u8; 32]);

    cliente.configurar_wasm_evento(&nuevo_hash);

    assert_eq!(cliente.obtener_wasm_evento(), nuevo_hash);
}

// Intenta inicializar la factory dos veces
// Se espera panic "already_init"
#[test]
#[should_panic(expected = "already_init")]
fn test_initialize_double_panics() {
    let (_entorno, cliente, admin) = configurar_fabrica();
    cliente.inicializar(&admin);
}

// Intenta inicializar sin autenticación (sin mock_all_auths)
// Se espera panic de auth inválido
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_initialize_without_auth_panics() {
    let entorno = Env::default();
    let admin = Address::generate(&entorno);
    let id_contrato = entorno.register(FabricaBoletos, ());
    let cliente = FabricaBoletosClient::new(&entorno, &id_contrato);
    cliente.inicializar(&admin);
}

// TESTS: CREACIÓN DE EVENTOS

// Crea un evento exitosamente y verifica que se registró con la dirección correcta
#[test]
fn test_create_event_success() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let config = crear_configuracion(&entorno, 1001, 20, 10, 5000);
    let contrato_evento = registrar_contrato_evento(&entorno);

    let direccion = cliente.crear_evento_contrato(&config, &contrato_evento);

    assert_eq!(direccion, contrato_evento);
    assert_eq!(cliente.obtener_contrato_evento(&1001), contrato_evento);
    assert_eq!(cliente.obtener_contador_eventos(), 1);
}

// Intenta crear un evento con comisiones que suman 100%
// Se espera panic "fees_too_high"
#[test]
#[should_panic(expected = "fees_too_high")]
fn test_create_event_invalid_fees_panics() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let config = crear_configuracion(&entorno, 1001, 80, 20, 5000);
    let contrato_evento = registrar_contrato_evento(&entorno);
    cliente.crear_evento_contrato(&config, &contrato_evento);
}

// Intenta crear un evento con capacidad 0
// Se espera panic "invalid_capacity"
#[test]
#[should_panic(expected = "invalid_capacity")]
fn test_create_event_invalid_capacity_panics() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let config = crear_configuracion(&entorno, 1001, 20, 10, 0);
    let contrato_evento = registrar_contrato_evento(&entorno);
    cliente.crear_evento_contrato(&config, &contrato_evento);
}

// Intenta crear dos eventos con el mismo id_evento
// Se espera panic "event_exists"
#[test]
#[should_panic(expected = "event_exists")]
fn test_create_event_duplicate_id_panics() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let config = crear_configuracion(&entorno, 1001, 20, 10, 5000);
    let c1 = registrar_contrato_evento(&entorno);
    let c2 = registrar_contrato_evento(&entorno);
    cliente.crear_evento_contrato(&config, &c1);
    cliente.crear_evento_contrato(&config, &c2);
}

// Intenta registrar la misma dirección de contrato para dos eventos distintos
// Se espera panic "contract_already_registered"
#[test]
#[should_panic(expected = "contract_already_registered")]
fn test_create_event_duplicate_contract_panics() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let config_1 = crear_configuracion(&entorno, 1001, 20, 10, 5000);
    let config_2 = crear_configuracion(&entorno, 1002, 20, 10, 5000);
    let contrato = registrar_contrato_evento(&entorno);

    cliente.crear_evento_contrato(&config_1, &contrato);
    cliente.crear_evento_contrato(&config_2, &contrato);
}

// TESTS: CONSULTAS

// Intenta obtener la dirección de un evento que no existe
// Se espera panic "event_not_found"
#[test]
#[should_panic(expected = "event_not_found")]
fn test_get_event_contract_not_found_panics() {
    let (_entorno, cliente, _admin) = configurar_fabrica();
    cliente.obtener_contrato_evento(&9999);
}

// Crea dos eventos independientes y verifica que cada uno tiene su propia dirección
// Se espera que el contador sea 2 y las direcciones sean distintas
#[test]
fn test_two_events_independent() {
    let (entorno, cliente, _admin) = configurar_fabrica();
    let config_1 = crear_configuracion(&entorno, 1001, 20, 10, 5000);
    let config_2 = crear_configuracion(&entorno, 1002, 15, 5, 10000);
    let c1 = registrar_contrato_evento(&entorno);
    let c2 = registrar_contrato_evento(&entorno);

    cliente.crear_evento_contrato(&config_1, &c1);
    cliente.crear_evento_contrato(&config_2, &c2);

    assert_eq!(cliente.obtener_contrato_evento(&1001), c1);
    assert_eq!(cliente.obtener_contrato_evento(&1002), c2);
    assert_eq!(cliente.obtener_contador_eventos(), 2);
}

// TESTS: INTEGRACIÓN

/*
  Verifica que un contrato de evento creado por la factory funciona correctamente:
  1. La factory crea y registra el evento
  2. El organizador puede crear boletos en el contrato hijo
  3. Los datos del boleto son correctos
  4. La factory sabe la dirección del contrato hijo
*/
#[test]
fn test_event_contract_funciona_despues_registrado() {
    let (entorno, cliente_fabrica, _admin) = configurar_fabrica();

    let admin_token = Address::generate(&entorno);
    let organizador = Address::generate(&entorno);
    let plataforma = Address::generate(&entorno);

    let id_event_contract = entorno.register(ContratoEvento, ());
    let cliente_evento = ContratoEventoClient::new(&entorno, &id_event_contract);

    let contrato_token = entorno.register_stellar_asset_contract_v2(admin_token.clone());
    let cliente_token = ClienteToken::new(&entorno, &contrato_token.address());

    let config = ConfiguracionEvento {
        id_evento: 7001,
        organizador: organizador.clone(),
        token_pago: contrato_token.address(),
        comision_organizador: 20,
        comision_plataforma: 10,
        wallet_organizador: organizador.clone(),
        wallet_plataforma: plataforma.clone(),
        capacidad_total: 100,
    };

    cliente_fabrica.crear_evento_contrato(&config, &id_event_contract);

    let root_id = cliente_evento.crear_boleto(&config.id_evento, &1_000_i128);

    let boleto = cliente_evento.obtener_boleto(&root_id);
    assert_eq!(boleto.id_evento, config.id_evento);
    assert_eq!(boleto.ticket_root_id, root_id);
    assert_eq!(boleto.propietario, organizador);
    assert_eq!(boleto.precio, 1_000);
    assert_eq!(
        cliente_fabrica.obtener_contrato_evento(&config.id_evento),
        id_event_contract
    );
    assert_eq!(cliente_fabrica.obtener_contador_eventos(), 1);

    assert_eq!(cliente_token.balance(&organizador), 0);
}
