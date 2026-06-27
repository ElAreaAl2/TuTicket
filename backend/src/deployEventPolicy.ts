export type DeployEventSnapshot = {
  id: string;
  contract_address?: string | null;
};

export type DeployEventDecision =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

export function authorizeSingleEventDeploy(input: {
  event: DeployEventSnapshot | null;
}): DeployEventDecision {
  if (!input.event) {
    return { ok: false, status: 404, error: 'Evento no encontrado' };
  }

  // On-chain is an opt-in layer on top of the Web2 flow: events routinely
  // already have Web2 tickets when the organizer decides to enable blockchain.
  // The only thing that must block a (re)deploy is an existing contract, since
  // that would orphan tickets already secured on-chain.
  if (input.event.contract_address) {
    return { ok: false, status: 409, error: 'El evento ya tiene contrato' };
  }

  return { ok: true };
}
