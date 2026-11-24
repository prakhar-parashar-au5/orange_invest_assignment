import { setupServer } from 'msw/node'
import { handlers } from '../mocks/handlers'

// Same handlers as `npm run dev:mock`, so tests and the mock dev server agree on behaviour.
export const server = setupServer(...handlers)
