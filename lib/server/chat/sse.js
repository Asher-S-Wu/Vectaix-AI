export function encodeSseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function encodeSseDone() {
  return "data: [DONE]\n\n";
}

export function createSseWriter(controller) {
  const encoder = new TextEncoder();
  return {
    send(payload) {
      controller.enqueue(encoder.encode(encodeSseData(payload)));
    },
    sendRaw(rawEvent) {
      controller.enqueue(encoder.encode(rawEvent));
    },
    done() {
      controller.enqueue(encoder.encode(encodeSseDone()));
    },
  };
}
