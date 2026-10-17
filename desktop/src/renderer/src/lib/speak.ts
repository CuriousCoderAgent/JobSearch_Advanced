// Reads a line aloud with the PC's own voices (offline), preferring an Indian
// English voice. Resolves when finished, or at once if speech is unavailable.
// Shared by the mock-interview panel and the Objection Dojo sceptic.
export async function speak(text: string): Promise<void> {
  const synth = window.speechSynthesis
  if (!synth) return
  if (!synth.getVoices().length) {
    await new Promise<void>((r) => { synth.addEventListener('voiceschanged', () => r(), { once: true }); setTimeout(r, 1200) })
  }
  const voices = synth.getVoices()
  const u = new SpeechSynthesisUtterance(text)
  u.voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang === 'en-GB') ?? voices.find((v) => v.lang.startsWith('en')) ?? null
  u.rate = 0.98
  synth.cancel()
  await new Promise<void>((resolve) => {
    u.onend = () => resolve()
    u.onerror = () => resolve()
    setTimeout(resolve, 2000 + text.length * 110) // never hang on a silent voice
    synth.speak(u)
  })
}
