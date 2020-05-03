import { mockWarn } from 'jest-mock-warn'
import { createMemoryHistory, createRouter } from '../src'
import { defineComponent } from 'vue'

let component = defineComponent({})

describe('warnings', () => {
  mockWarn()
  it('warns on missing name and path for redirect', async () => {
    const history = createMemoryHistory()
    const router = createRouter({
      history,
      routes: [
        { path: '/', component },
        { path: '/redirect', redirect: { params: { foo: 'f' } } },
      ],
    })
    await router.push('/redirect').catch(() => {})
    expect('Invalid redirect found').toHaveBeenWarned()
  })

  it('warns when resolving a route with path and params', async () => {
    const history = createMemoryHistory()
    const router = createRouter({
      history,
      routes: [{ path: '/:p', name: 'p', component }],
    })
    router.resolve({ path: '/', params: { p: 'p' } })
    expect('Path "/" was passed with params').toHaveBeenWarned()
  })

  it('does not warn when resolving a route with path, params and name', async () => {
    const history = createMemoryHistory()
    const router = createRouter({
      history,
      routes: [{ path: '/:p', name: 'p', component }],
    })
    router.resolve({ path: '/p', name: 'p', params: { p: 'p' } })
    expect('Path "/" was passed with params').not.toHaveBeenWarned()
  })

  it('warns if an alias is missing params', async () => {
    createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p/:c', alias: ['/:p/c'], component }],
    })
    expect(
      'Alias "/:p/c" and the original record: "/:p/:c" should have the exact same param named "c"'
    ).toHaveBeenWarned()
  })

  it('warns if a child with absolute path is missing a parent param', async () => {
    createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/:a',
          component,
          children: [
            {
              path: ':b',
              component,
              children: [{ path: '/:a/b', component }],
            },
          ],
        },
      ],
    })
    expect(
      `Absolute path "/:a/b" should have the exact same param named "b" as its parent "/:a/:b".`
    ).toHaveBeenWarned()
  })

  it('warns if an alias has a param with the same name but different', async () => {
    createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p/:c', alias: ['/:p/:c+'], component }],
    })
    expect(
      'Alias "/:p/:c+" and the original record: "/:p/:c" should have the exact same param named "c"'
    ).toHaveBeenWarned()
  })

  it('warns if an alias has extra params', async () => {
    createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p/c', alias: ['/:p/:c'], component }],
    })
    expect(
      'Alias "/:p/:c" and the original record: "/:p/c" should have the exact same param named "c"'
    ).toHaveBeenWarned()
  })
})
