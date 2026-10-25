// Vercel function: No Clicking's daily leaderboard (noclick/board.mjs). Answers 503 until it has a lasting store.
import { handleBoard } from '../noclick/board.mjs';
export default function handler(req, res) { return handleBoard(req, res); }
