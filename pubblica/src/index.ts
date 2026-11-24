// Casa è tutta statica: questo codice risponde solo quando nessun file corrisponde al percorso.
// Le intestazioni di public/_headers valgono solo per i file, non per questa risposta: qui le essenziali.
export default {
  async fetch(): Promise<Response> {
    return new Response("Pagina non trovata. Casa è su https://casa.raccasamuele.it/", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  },
};
