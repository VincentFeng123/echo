// Vercel function: No Clicking's AI backup referee (noclick/judge.mjs). Needs OPENAI_API_KEY in the project's env.
import { handleJudge } from '../noclick/judge.mjs';
export default function handler(req, res) { return handleJudge(req, res); }
