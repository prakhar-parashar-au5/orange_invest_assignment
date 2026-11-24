import { request } from './client'

// API-CONTRACT v1.7 "Artifacts". Any logged-in user.
export const listArtifacts = () => request('/artifacts')
export const getArtifact = (name) => request(`/artifacts/${encodeURIComponent(name)}`)
