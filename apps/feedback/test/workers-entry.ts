// Entry for the Workers test runtime. The tests build the app themselves
// (createFeedbackApp) with fake Turnstile and Discord; nothing serves here.
export default {
  fetch(): Response {
    return new Response("matchbox-feedback test entry")
  },
}
