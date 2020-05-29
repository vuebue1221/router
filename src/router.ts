import {
  RouteLocationNormalized,
  RouteRecordRaw,
  RouteLocationRaw,
  PostNavigationGuard,
  START_LOCATION_NORMALIZED,
  Lazy,
  RouteLocationNormalizedLoaded,
  RouteLocation,
  RouteRecordName,
  isRouteName,
  NavigationGuardWithThis,
  RouteLocationOptions,
  MatcherLocationRaw,
} from './types'
import { RouterHistory, HistoryState } from './history/common'
import {
  ScrollPosition,
  getSavedScrollPosition,
  getScrollKey,
  saveScrollPosition,
  computeScrollPosition,
  scrollToPosition,
  _ScrollPositionNormalized,
} from './scrollBehavior'
import { createRouterMatcher, PathParserOptions } from './matcher'
import {
  createRouterError,
  ErrorTypes,
  NavigationFailure,
  NavigationRedirectError,
} from './errors'
import { applyToParams, isBrowser } from './utils'
import { useCallbacks } from './utils/callbacks'
import { encodeParam, decode, encodeHash } from './encoding'
import {
  normalizeQuery,
  parseQuery as originalParseQuery,
  stringifyQuery as originalStringifyQuery,
} from './query'
import { shallowRef, Ref, nextTick, App } from 'vue'
import { RouteRecord, RouteRecordNormalized } from './matcher/types'
import { parseURL, stringifyURL, isSameRouteLocation } from './location'
import { extractComponentsGuards, guardToPromiseFn } from './navigationGuards'
import { applyRouterPlugin } from './install'
import { warn } from './warning'

/**
 * Internal type to define an ErrorHandler
 * @internal
 */
export type ErrorHandler = (error: any) => any
// resolve, reject arguments of Promise constructor
type OnReadyCallback = [() => void, (reason?: any) => void]

type Awaitable<T> = T | Promise<T>

export interface ScrollBehavior {
  (
    to: RouteLocationNormalized,
    from: RouteLocationNormalizedLoaded,
    savedPosition: _ScrollPositionNormalized | null
  ): Awaitable<ScrollPosition | false | void>
}

export interface RouterOptions extends PathParserOptions {
  /**
   * History implementation used by the router. Most web applications should use
   * `createWebHistory` but it requires the server to be properly configured.
   * You can also use a _hash_ based history with `createWebHashHistory` that
   * does not require any configuration on the server but isn't handled at all
   * by search engines and does poorly on SEO.
   *
   * @example
   * ```js
   * createRouter({
   *   history: createWebHistory(),
   *   // other options...
   * })
   * ```
   */
  history: RouterHistory
  /**
   * Initial list of routes that should be added to the router.
   */
  routes: RouteRecordRaw[]
  /**
   * Function to control scrolling when navigating between pages.
   */
  scrollBehavior?: ScrollBehavior
  /**
   * Custom implementation to parse a query.
   *
   * @example
   * Let's say you want to use the package {@link https://github.com/ljharb/qs | `qs`}
   * to parse queries, you would need to provide both `parseQuery` and
   * {@link RouterOptions.stringifyQuery | `stringifyQuery`}:
   * ```js
   * import qs from 'qs'
   *
   * createRouter({
   *   // other options...
   *   parse: qs.parse,
   *   stringifyQuery: qs.stringify,
   * })
   * ```
   */
  parseQuery?: typeof originalParseQuery
  /**
   * {@link RouterOptions.parseQuery | `parseQuery`} counterpart to handle query parsing.
   */
  stringifyQuery?: typeof originalStringifyQuery
  /**
   * Default class applied to active {@link RouterLink}. If none is provided,
   * `router-link-active` will be applied.
   */
  linkActiveClass?: string
  /**
   * Default class applied to exact active {@link RouterLink}. If none is provided,
   * `router-link-exact-active` will be applied.
   */
  linkExactActiveClass?: string
  /**
   * Default class applied to non active {@link RouterLink}. If none is provided,
   * `router-link-inactive` will be applied.
   */
  // linkInactiveClass?: string
}

export interface Router {
  readonly history: RouterHistory
  readonly currentRoute: Ref<RouteLocationNormalizedLoaded>
  readonly options: RouterOptions

  addRoute(parentName: RouteRecordName, route: RouteRecordRaw): () => void
  addRoute(route: RouteRecordRaw): () => void
  removeRoute(name: RouteRecordName): void
  hasRoute(name: RouteRecordName): boolean
  getRoutes(): RouteRecord[]

  resolve(to: RouteLocationRaw): RouteLocation & { href: string }

  push(to: RouteLocationRaw): Promise<NavigationFailure | void | undefined>
  replace(to: RouteLocationRaw): Promise<NavigationFailure | void | undefined>
  back(): Promise<NavigationFailure | void | undefined>
  forward(): Promise<NavigationFailure | void | undefined>
  go(delta: number): Promise<NavigationFailure | void | undefined>

  beforeEach(guard: NavigationGuardWithThis<undefined>): () => void
  beforeResolve(guard: NavigationGuardWithThis<undefined>): () => void
  afterEach(guard: PostNavigationGuard): () => void

  onError(handler: ErrorHandler): () => void
  isReady(): Promise<void>

  install(app: App): void
}

/**
 * Create a Router instance that can be used on a Vue app.
 *
 * @param options - {@link RouterOptions}
 */
export function createRouter(options: RouterOptions): Router {
  const matcher = createRouterMatcher(options.routes, options)
  let parseQuery = options.parseQuery || originalParseQuery
  let stringifyQuery = options.stringifyQuery || originalStringifyQuery
  let { scrollBehavior } = options
  let routerHistory = options.history

  const beforeGuards = useCallbacks<NavigationGuardWithThis<undefined>>()
  const beforeResolveGuards = useCallbacks<NavigationGuardWithThis<undefined>>()
  const afterGuards = useCallbacks<PostNavigationGuard>()
  const currentRoute = shallowRef<RouteLocationNormalizedLoaded>(
    START_LOCATION_NORMALIZED
  )
  let pendingLocation: RouteLocation = START_LOCATION_NORMALIZED

  // leave the scrollRestoration if no scrollBehavior is provided
  if (isBrowser && scrollBehavior && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual'
  }

  const normalizeParams = applyToParams.bind(
    null,
    paramValue => '' + paramValue
  )
  const encodeParams = applyToParams.bind(null, encodeParam)
  const decodeParams = applyToParams.bind(null, decode)

  function addRoute(
    parentOrRoute: RouteRecordName | RouteRecordRaw,
    route?: RouteRecordRaw
  ) {
    let parent: Parameters<typeof matcher['addRoute']>[1] | undefined
    let record: RouteRecordRaw
    if (isRouteName(parentOrRoute)) {
      parent = matcher.getRecordMatcher(parentOrRoute)
      record = route!
    } else {
      record = parentOrRoute
    }

    return matcher.addRoute(record, parent)
  }

  function removeRoute(name: RouteRecordName) {
    let recordMatcher = matcher.getRecordMatcher(name)
    if (recordMatcher) {
      matcher.removeRoute(recordMatcher)
    } else if (__DEV__) {
      warn(`Cannot remove non-existent route "${String(name)}"`)
    }
  }

  function getRoutes() {
    return matcher.getRoutes().map(routeMatcher => routeMatcher.record)
  }

  function hasRoute(name: RouteRecordName): boolean {
    return !!matcher.getRecordMatcher(name)
  }

  function resolve(
    rawLocation: Readonly<RouteLocationRaw>,
    currentLocation?: Readonly<RouteLocationNormalizedLoaded>
  ): RouteLocation & { href: string } {
    // const objectLocation = routerLocationAsObject(rawLocation)
    currentLocation = currentLocation || currentRoute.value
    if (typeof rawLocation === 'string') {
      let locationNormalized = parseURL(
        parseQuery,
        rawLocation,
        currentLocation.path
      )
      let matchedRoute = matcher.resolve(
        { path: locationNormalized.path },
        currentLocation
      )

      if (__DEV__) {
        let href = routerHistory.base + locationNormalized.fullPath
        if (href.startsWith('//'))
          warn(
            `Location "${rawLocation}" resolved to "${href}". A resolved location cannot start with multiple slashes.`
          )
        else if (!matchedRoute.matched.length) {
          warn(`No match found for location with path "${rawLocation}"`)
        }
      }

      return {
        // fullPath: locationNormalized.fullPath,
        // query: locationNormalized.query,
        // hash: locationNormalized.hash,
        ...locationNormalized,
        ...matchedRoute,
        // path: matchedRoute.path,
        // name: matchedRoute.name,
        // meta: matchedRoute.meta,
        // matched: matchedRoute.matched,
        params: decodeParams(matchedRoute.params),
        redirectedFrom: undefined,
        href: routerHistory.base + locationNormalized.fullPath,
      }
    }

    let matcherLocation: MatcherLocationRaw

    // path could be relative in object as well
    if ('path' in rawLocation) {
      if (
        __DEV__ &&
        'params' in rawLocation &&
        !('name' in rawLocation) &&
        Object.keys((rawLocation as any).params).length
      ) {
        warn(
          `Path "${
            (rawLocation as any).path
          }" was passed with params but they will be ignored. Use a named route alongside params instead.`
        )
      }
      matcherLocation = {
        ...rawLocation,
        path: parseURL(parseQuery, rawLocation.path, currentLocation.path).path,
      }
    } else {
      matcherLocation = {
        ...rawLocation,
        params: encodeParams(rawLocation.params),
      }
    }

    let matchedRoute = matcher.resolve(matcherLocation, currentLocation)
    const hash = encodeHash(rawLocation.hash || '')

    if (__DEV__ && hash && hash[0] !== '#') {
      warn(
        `A \`hash\` should always start with the character "#". Replace "${hash}" with "#${hash}".`
      )
    }

    // put back the unencoded params as given by the user (avoid the cost of decoding them)
    matchedRoute.params =
      'params' in rawLocation
        ? normalizeParams(rawLocation.params)
        : decodeParams(matchedRoute.params)

    const fullPath = stringifyURL(stringifyQuery, {
      ...rawLocation,
      hash,
      path: matchedRoute.path,
    })

    if (__DEV__) {
      let href = routerHistory.base + fullPath
      if (href.startsWith('//'))
        warn(
          `Location "${rawLocation}" resolved to "${href}". A resolved location cannot start with multiple slashes.`
        )
      else if (!matchedRoute.matched.length) {
        warn(
          `No match found for location with path "${
            'path' in rawLocation ? rawLocation.path : rawLocation
          }"`
        )
      }
    }

    return {
      fullPath,
      // keep the hash encoded so fullPath is effectively path + encodedQuery +
      // hash
      hash,
      query: normalizeQuery(rawLocation.query),
      ...matchedRoute,
      redirectedFrom: undefined,
      href: routerHistory.base + fullPath,
    }
  }

  function locationAsObject(
    to: RouteLocationRaw | RouteLocationNormalized
  ): Exclude<RouteLocationRaw, string> | RouteLocationNormalized {
    return typeof to === 'string' ? { path: to } : to
  }

  function push(to: RouteLocationRaw | RouteLocation) {
    return pushWithRedirect(to)
  }

  function replace(to: RouteLocationRaw | RouteLocationNormalized) {
    return push({ ...locationAsObject(to), replace: true })
  }

  function pushWithRedirect(
    to: RouteLocationRaw | RouteLocation,
    redirectedFrom?: RouteLocation
  ): Promise<NavigationFailure | void | undefined> {
    const targetLocation: RouteLocation = (pendingLocation = resolve(to))
    const from = currentRoute.value
    const data: HistoryState | undefined = (to as RouteLocationOptions).state
    const force: boolean | undefined = (to as RouteLocationOptions).force
    // to could be a string where `replace` is a function
    const replace = (to as RouteLocationOptions).replace === true

    const lastMatched =
      targetLocation.matched[targetLocation.matched.length - 1]
    if (lastMatched && 'redirect' in lastMatched) {
      const { redirect } = lastMatched
      // transform it into an object to pass the original RouteLocaleOptions
      let newTargetLocation = locationAsObject(
        typeof redirect === 'function' ? redirect(targetLocation) : redirect
      )

      if (
        __DEV__ &&
        !('path' in newTargetLocation) &&
        !('name' in newTargetLocation)
      ) {
        warn(
          `Invalid redirect found:\n${JSON.stringify(
            newTargetLocation,
            null,
            2
          )}\n when navigating to "${
            targetLocation.fullPath
          }". A redirect must contain a name or path.`
        )
        return Promise.reject(new Error('Invalid redirect'))
      }
      return pushWithRedirect(
        {
          // having a path here would be a problem with relative locations but
          // at the same time it doesn't make sense for a redirect to be
          // relative (no name, no path) because it would create an infinite
          // loop. Since newTargetLocation must either have a `path` or a
          // `name`, this will never happen
          ...targetLocation,
          ...newTargetLocation,
          state: data,
          force,
          replace,
        },
        // keep original redirectedFrom if it exists
        redirectedFrom || targetLocation
      )
    }

    // if it was a redirect we already called `pushWithRedirect` above
    const toLocation = targetLocation as RouteLocationNormalized

    toLocation.redirectedFrom = redirectedFrom
    let failure: NavigationFailure | void | undefined

    if (!force && isSameRouteLocation(from, targetLocation)) {
      failure = createRouterError<NavigationFailure>(
        ErrorTypes.NAVIGATION_DUPLICATED,
        { to: toLocation, from }
      )
      // trigger scroll to allow scrolling to the same anchor
      handleScroll(
        from,
        from,
        // this is a push, the only way for it to be triggered from a
        // history.listen is with a redirect, which makes it become a pus
        true,
        // This cannot be the first navigation because the initial location
        // cannot be manually navigated to
        false
      )
    }

    return (failure ? Promise.resolve(failure) : navigate(toLocation, from))
      .catch((error: NavigationFailure | NavigationRedirectError) => {
        // a more recent navigation took place
        if (pendingLocation !== toLocation) {
          return createRouterError<NavigationFailure>(
            ErrorTypes.NAVIGATION_CANCELLED,
            {
              from,
              to: toLocation,
            }
          )
        }
        if (
          error.type === ErrorTypes.NAVIGATION_ABORTED ||
          error.type === ErrorTypes.NAVIGATION_GUARD_REDIRECT
        ) {
          return error
        }
        // unknown error, rejects
        return triggerError(error)
      })
      .then((failure: NavigationFailure | NavigationRedirectError | void) => {
        if (failure) {
          if (failure.type === ErrorTypes.NAVIGATION_GUARD_REDIRECT)
            // preserve the original redirectedFrom if any
            return pushWithRedirect(
              // keep options
              {
                ...locationAsObject(failure.to),
                state: data,
                force,
                replace,
              },
              redirectedFrom || toLocation
            )
        } else {
          // if we fail we don't finalize the navigation
          failure = finalizeNavigation(
            toLocation as RouteLocationNormalizedLoaded,
            from,
            true,
            replace,
            data
          )
        }
        triggerAfterEach(
          toLocation as RouteLocationNormalizedLoaded,
          from,
          failure
        )
        return failure
      })
  }

  function navigate(
    to: RouteLocationNormalized,
    from: RouteLocationNormalizedLoaded
  ): Promise<any> {
    let guards: Lazy<any>[]

    // all components here have been resolved once because we are leaving
    guards = extractComponentsGuards(
      from.matched.filter(record => to.matched.indexOf(record) < 0).reverse(),
      'beforeRouteLeave',
      to,
      from
    )

    const [
      leavingRecords,
      updatingRecords,
      // enteringRecords,
    ] = extractChangingRecords(to, from)

    for (const record of leavingRecords) {
      for (const guard of record.leaveGuards) {
        guards.push(guardToPromiseFn(guard, to, from))
      }
    }

    // run the queue of per route beforeRouteLeave guards
    return runGuardQueue(guards)
      .then(() => {
        // check global guards beforeEach
        guards = []
        for (const guard of beforeGuards.list()) {
          guards.push(guardToPromiseFn(guard, to, from))
        }

        return runGuardQueue(guards)
      })
      .then(() => {
        // check in components beforeRouteUpdate
        guards = extractComponentsGuards(
          to.matched.filter(record => from.matched.indexOf(record as any) > -1),
          'beforeRouteUpdate',
          to,
          from
        )

        for (const record of updatingRecords) {
          for (const guard of record.updateGuards) {
            guards.push(guardToPromiseFn(guard, to, from))
          }
        }

        // run the queue of per route beforeEnter guards
        return runGuardQueue(guards)
      })
      .then(() => {
        // check the route beforeEnter
        guards = []
        for (const record of to.matched) {
          // do not trigger beforeEnter on reused views
          if (record.beforeEnter && from.matched.indexOf(record as any) < 0) {
            if (Array.isArray(record.beforeEnter)) {
              for (const beforeEnter of record.beforeEnter)
                guards.push(guardToPromiseFn(beforeEnter, to, from))
            } else {
              guards.push(guardToPromiseFn(record.beforeEnter, to, from))
            }
          }
        }

        // run the queue of per route beforeEnter guards
        return runGuardQueue(guards)
      })
      .then(() => {
        // NOTE: at this point to.matched is normalized and does not contain any () => Promise<Component>

        // check in-component beforeRouteEnter
        guards = extractComponentsGuards(
          // the type doesn't matter as we are comparing an object per reference
          to.matched.filter(record => from.matched.indexOf(record as any) < 0),
          'beforeRouteEnter',
          to,
          from
        )

        // run the queue of per route beforeEnter guards
        return runGuardQueue(guards)
      })
      .then(() => {
        // check global guards beforeResolve
        guards = []
        for (const guard of beforeResolveGuards.list()) {
          guards.push(guardToPromiseFn(guard, to, from))
        }

        return runGuardQueue(guards)
      })
  }

  function triggerAfterEach(
    to: RouteLocationNormalizedLoaded,
    from: RouteLocationNormalizedLoaded,
    failure?: NavigationFailure | void
  ): void {
    // navigation is confirmed, call afterGuards
    // TODO: wrap with error handlers
    for (const guard of afterGuards.list()) guard(to, from, failure)
  }

  /**
   * - Cleans up any navigation guards
   * - Changes the url if necessary
   * - Calls the scrollBehavior
   */
  function finalizeNavigation(
    toLocation: RouteLocationNormalizedLoaded,
    from: RouteLocationNormalizedLoaded,
    isPush: boolean,
    replace?: boolean,
    data?: HistoryState
  ): NavigationFailure | void {
    // a more recent navigation took place
    if (pendingLocation !== toLocation) {
      return createRouterError<NavigationFailure>(
        ErrorTypes.NAVIGATION_CANCELLED,
        {
          from,
          to: toLocation,
        }
      )
    }

    const [leavingRecords] = extractChangingRecords(toLocation, from)
    for (const record of leavingRecords) {
      // remove registered guards from removed matched records
      record.leaveGuards = []
      // free the references

      // TODO: to refactor once keep-alive and transition can be supported
      record.instances = {}
    }

    // only consider as push if it's not the first navigation
    const isFirstNavigation = from === START_LOCATION_NORMALIZED
    const state = !isBrowser ? {} : history.state

    // change URL only if the user did a push/replace and if it's not the initial navigation because
    // it's just reflecting the url
    if (isPush) {
      // on the initial navigation, we want to reuse the scroll position from
      // history state if it exists
      if (replace || isFirstNavigation)
        routerHistory.replace(toLocation, {
          scroll: isFirstNavigation && state && state.scroll,
          ...data,
        })
      else routerHistory.push(toLocation, data)
    }

    // accept current navigation
    currentRoute.value = toLocation
    handleScroll(toLocation, from, isPush, isFirstNavigation)

    markAsReady()
  }

  // attach listener to history to trigger navigations
  routerHistory.listen((to, _from, info) => {
    // TODO: in dev try catch to correctly log the matcher error
    // cannot be a redirect route because it was in history
    const toLocation = resolve(to.fullPath) as RouteLocationNormalized

    pendingLocation = toLocation
    const from = currentRoute.value

    // TODO: should be moved to web history?
    if (isBrowser) {
      saveScrollPosition(
        getScrollKey(from.fullPath, info.delta),
        computeScrollPosition()
      )
    }

    navigate(toLocation, from)
      .catch((error: NavigationFailure | NavigationRedirectError) => {
        // a more recent navigation took place
        if (pendingLocation !== toLocation) {
          return createRouterError<NavigationFailure>(
            ErrorTypes.NAVIGATION_CANCELLED,
            {
              from,
              to: toLocation,
            }
          )
        }
        if (error.type === ErrorTypes.NAVIGATION_ABORTED) {
          return error as NavigationFailure
        }
        if (error.type === ErrorTypes.NAVIGATION_GUARD_REDIRECT) {
          routerHistory.go(-info.delta, false)
          // the error is already handled by router.push we just want to avoid
          // logging the error
          pushWithRedirect(
            (error as NavigationRedirectError).to,
            toLocation
          ).catch(() => {
            // TODO: in dev show warning, in prod triggerError, same as initial navigation
          })
          // avoid the then branch
          return Promise.reject()
        }
        // TODO: test on different browsers ensure consistent behavior
        routerHistory.go(-info.delta, false)
        // unrecognized error, transfer to the global handler
        return triggerError(error)
      })
      .then((failure: NavigationFailure | void) => {
        failure =
          failure ||
          finalizeNavigation(
            // after navigation, all matched components are resolved
            toLocation as RouteLocationNormalizedLoaded,
            from,
            false
          )

        // revert the navigation
        if (failure) routerHistory.go(-info.delta, false)

        triggerAfterEach(
          toLocation as RouteLocationNormalizedLoaded,
          from,
          failure
        )
      })
      .catch(() => {
        // TODO: same as above
      })
  })

  // Initialization and Errors

  let readyHandlers = useCallbacks<OnReadyCallback>()
  let errorHandlers = useCallbacks<ErrorHandler>()
  let ready: boolean

  /**
   * Trigger errorHandlers added via onError and throws the error as well
   * @param error - error to throw
   * @returns the error as a rejected promise
   */
  function triggerError(error: any) {
    markAsReady(error)
    errorHandlers.list().forEach(handler => handler(error))
    return Promise.reject(error)
  }

  /**
   * Returns a Promise that resolves or reject when the router has finished its
   * initial navigation. This will be automatic on client but requires an
   * explicit `router.push` call on the server. This behavior can change
   * depending on the history implementation used e.g. the defaults history
   * implementation (client only) triggers this automatically but the memory one
   * (should be used on server) doesn't
   */
  function isReady(): Promise<void> {
    if (ready && currentRoute.value !== START_LOCATION_NORMALIZED)
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      readyHandlers.add([resolve, reject])
    })
  }

  /**
   * Mark the router as ready, resolving the promised returned by isReady(). Can
   * only be called once, otherwise does nothing.
   * @param err - optional error
   */
  function markAsReady(err?: any): void {
    if (ready) return
    ready = true
    readyHandlers
      .list()
      .forEach(([resolve, reject]) => (err ? reject(err) : resolve()))
    readyHandlers.reset()
  }

  // Scroll behavior
  function handleScroll(
    to: RouteLocationNormalizedLoaded,
    from: RouteLocationNormalizedLoaded,
    isPush: boolean,
    isFirstNavigation: boolean
  ): Promise<any> {
    if (!isBrowser || !scrollBehavior) return Promise.resolve()

    let scrollPosition: _ScrollPositionNormalized | null =
      (!isPush && getSavedScrollPosition(getScrollKey(to.fullPath, 0))) ||
      ((isFirstNavigation || !isPush) &&
        (history.state as HistoryState) &&
        history.state.scroll) ||
      null

    return nextTick()
      .then(() => scrollBehavior!(to, from, scrollPosition))
      .then(position => position && scrollToPosition(position))
      .catch(triggerError)
  }

  function go(delta: number) {
    return new Promise<NavigationFailure | void | undefined>(
      (resolve, reject) => {
        let removeError = errorHandlers.add(err => {
          removeError()
          removeAfterEach()
          reject(err)
        })
        let removeAfterEach = afterGuards.add((_to, _from, failure) => {
          removeError()
          removeAfterEach()
          resolve(failure)
        })

        routerHistory.go(delta)
      }
    )
  }

  const router: Router = {
    currentRoute,

    addRoute,
    removeRoute,
    hasRoute,
    getRoutes,
    resolve,
    options,

    push,
    replace,
    go,
    back: () => go(-1),
    forward: () => go(1),

    beforeEach: beforeGuards.add,
    beforeResolve: beforeResolveGuards.add,
    afterEach: afterGuards.add,

    onError: errorHandlers.add,
    isReady,

    history: routerHistory,
    install(app: App) {
      applyRouterPlugin(app, this)
    },
  }

  return router
}

function runGuardQueue(guards: Lazy<any>[]): Promise<void> {
  return guards.reduce(
    (promise, guard) => promise.then(() => guard()),
    Promise.resolve()
  )
}

function extractChangingRecords(
  to: RouteLocationNormalized,
  from: RouteLocationNormalizedLoaded
) {
  const leavingRecords: RouteRecordNormalized[] = []
  const updatingRecords: RouteRecordNormalized[] = []
  const enteringRecords: RouteRecordNormalized[] = []

  // TODO: could be optimized with one single for loop
  for (const record of from.matched) {
    if (to.matched.indexOf(record) < 0) leavingRecords.push(record)
    else updatingRecords.push(record)
  }

  for (const record of to.matched) {
    // the type doesn't matter because we are comparing per reference
    if (from.matched.indexOf(record as any) < 0) enteringRecords.push(record)
  }

  return [leavingRecords, updatingRecords, enteringRecords]
}
