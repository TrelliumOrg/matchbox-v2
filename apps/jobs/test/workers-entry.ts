// Entry for the Workers test runtime; the jobs under test are imported by
// the tests themselves.
export default {
  fetch(): Response {
    return new Response("matchbox-jobs test entry")
  },
}
