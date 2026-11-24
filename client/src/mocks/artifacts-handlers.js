import { http, HttpResponse } from 'msw'
import { API_URL } from '../api/config'
import { db } from './db'
import { ARTIFACT_LIST, ARTIFACTS } from './artifacts-data'

// MSW handlers for API-CONTRACT v1.7 "Artifacts". Any logged-in user; unknown names → 404.
const url = (p) => `${API_URL}/api${p}`
const err = (status, code, message) => HttpResponse.json({ error: { code, message } }, { status })
const loggedIn = () => db().users.some((u) => u.id === db().sessionUserId)

export const artifactsHandlers = [
  http.get(url('/artifacts'), () =>
    loggedIn() ? HttpResponse.json({ artifacts: ARTIFACT_LIST }) : err(401, 'UNAUTHENTICATED', 'Please log in.'),
  ),
  http.get(url('/artifacts/:name'), ({ params }) => {
    if (!loggedIn()) return err(401, 'UNAUTHENTICATED', 'Please log in.')
    const meta = ARTIFACT_LIST.find((a) => a.name === params.name)
    if (!meta) return err(404, 'NOT_FOUND', 'No such artifact')
    return HttpResponse.json({ ...meta, ...ARTIFACTS[meta.name] })
  }),
]
