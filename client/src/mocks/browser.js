import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

// Used only by `npm run dev:mock`. State lives in memory and resets on page reload.
export const worker = setupWorker(...handlers)
