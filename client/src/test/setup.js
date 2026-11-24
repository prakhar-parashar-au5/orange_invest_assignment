import '@testing-library/jest-dom/vitest'
import { File as NodeFile } from 'node:buffer'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './server'
import { resetMockDb } from '../mocks/db'

// jsdom brings its own File/FormData, but fetch here is Node's (undici), which can't serialise a
// jsdom FormData correctly (the file name is lost). Browsers have one FormData, so use Node's in
// tests to match. Response is Node's too (jsdom has none); it hands us Node's FormData class.
const NodeFormData = (
  await new Response('a=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }).formData()
).constructor
const JsdomFormData = globalThis.FormData
// React 19 calls `new FormData(formElement)` on submit; Node's FormData can't read a jsdom form,
// so copy the entries over from jsdom's own FormData in that case.
class TestFormData extends NodeFormData {
  constructor(form, submitter) {
    super()
    if (form !== undefined) for (const [k, v] of new JsdomFormData(form, submitter)) this.append(k, v)
  }
}
globalThis.File = NodeFile
globalThis.FormData = TestFormData

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetMockDb()
})
afterAll(() => server.close())
