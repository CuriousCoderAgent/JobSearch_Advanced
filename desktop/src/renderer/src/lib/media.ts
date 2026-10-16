// Opening the camera and microphone for practice and mock interviews, with a
// plain reason when Windows won't start one of them.

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true }
const VIDEO: MediaTrackConstraints = { width: 1280, height: 720 }

export function mediaProblem(e: unknown, what: 'camera' | 'microphone'): string {
  const name = (e as DOMException | undefined)?.name
  const setting = what === 'camera' ? 'Camera' : 'Microphone'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Windows is blocking the ${what}. Turn it on in Settings → Privacy & security → ${setting}, including “Let desktop apps access your ${what}”.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} found — check it’s plugged in.`
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `The ${what} is connected but wouldn’t start. Usually another app has it (Teams, Zoom, a browser tab, Logi Tune), or it needs unplugging and plugging back in.`
  }
  return `Couldn’t start the ${what}: ${(e as Error | undefined)?.message || String(e)}`
}

/**
 * Opens the microphone, and the camera too when asked. If only the camera
 * fails, the microphone is returned on its own with the camera's problem, so
 * practice can carry on with sound alone. Throws a readable message when the
 * microphone fails.
 */
export async function openMedia(withVideo: boolean): Promise<{ stream: MediaStream; cameraIssue: string | null }> {
  if (withVideo) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: VIDEO }), cameraIssue: null }
    } catch (e) {
      const cameraIssue = mediaProblem(e, 'camera')
      try {
        return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO }), cameraIssue }
      } catch (micError) {
        throw new Error(mediaProblem(micError, 'microphone'))
      }
    }
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO }), cameraIssue: null }
  } catch (e) {
    throw new Error(mediaProblem(e, 'microphone'))
  }
}
