import { createQueryClient } from './query-client'

describe('createQueryClient', () => {
  it('uses sync defaults from architecture §7.1', () => {
    const q = createQueryClient().getDefaultOptions().queries
    expect(q).toMatchObject({
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 30_000,
    })
  })
})
