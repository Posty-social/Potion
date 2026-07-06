import handler from '@tanstack/react-start/server-entry'

export { PageDoc } from './lib/realtime/page-doc'

export default {
  fetch: handler.fetch,
}
