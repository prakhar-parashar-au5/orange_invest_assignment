import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { seedUser } from '../mocks/db'

/** Render the whole app at `path`. `as` logs a mock user in first (stands in for the cookie). */
export function renderApp(path = '/', { as } = {}) {
  const user = as ? seedUser(as, { login: true }) : null
  // applyAccept: false so files reach the app's own type check, the same as a drag-and-drop.
  const ui = userEvent.setup({ applyAccept: false })
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return { ...utils, user, ui }
}
