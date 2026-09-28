import { z } from 'zod'
import { bulkParse } from '../ai'
import { hasApiKey } from '../secrets'
import { fetchJobDescription, type JdHint } from './adapters'

// Full job description for a role. ATS endpoints give clean text for free; a
// plain page read is tidied by Haiku (a fraction of a cent) when a key is set.
export async function getJobDescription(url: string, hint: JdHint = {}): Promise<string | null> {
  const got = await fetchJobDescription(url, hint)
  if (!got) return null
  if (!got.generic || !hasApiKey()) return got.text
  try {
    const out = await bulkParse('jobs: read job description', {
      system:
        'You extract the job description from the text of a job posting page. Return the posting’s own content — ' +
        'role summary, responsibilities, requirements, and compensation or location if stated — verbatim where possible, ' +
        'as plain text with "- " bullets. Drop navigation, cookie notices, other listings and footer text. If the page ' +
        'is not a single job posting, return an empty string.',
      content: got.text.slice(0, 25000),
      schema: z.object({ description: z.string() }),
      maxTokens: 6000
    })
    return out.description.trim().length > 200 ? out.description.trim() : null
  } catch {
    return got.text
  }
}
