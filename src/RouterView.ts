import {
  h,
  inject,
  provide,
  defineComponent,
  PropType,
  ref,
  ComponentPublicInstance,
  VNodeProps,
  getCurrentInstance,
  computed,
  AllowedComponentProps,
  ComponentCustomProps,
} from 'vue'
import {
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
  RouteLocationMatched,
} from './types'
import {
  matchedRouteKey,
  viewDepthKey,
  routeLocationKey,
} from './injectionSymbols'
import { assign } from './utils'
import { warn } from './warning'

export interface RouterViewProps {
  name?: string
  // allow looser type for user facing api
  route?: RouteLocationNormalized
}

export const RouterViewImpl = defineComponent({
  name: 'RouterView',
  props: {
    name: {
      type: String as PropType<string>,
      default: 'default',
    },
    route: Object as PropType<RouteLocationNormalizedLoaded>,
  },

  setup(props, { attrs, slots }) {
    __DEV__ && warnDeprecatedUsage()

    const injectedRoute = inject(routeLocationKey)!
    const depth = inject(viewDepthKey, 0)
    const matchedRouteRef = computed<RouteLocationMatched | undefined>(
      () => (props.route || injectedRoute).matched[depth]
    )

    provide(viewDepthKey, depth + 1)
    provide(matchedRouteKey, matchedRouteRef)

    const viewRef = ref<ComponentPublicInstance>()

    // when the same component is used in different routes, the onVnodeMounted
    // hook doesn't trigger, so we need to observe the changing route to update
    // the instance on the record
    // watch(matchedRouteRef, to => {
    //   const currentName = props.name
    //   // to can be null if there isn't a matched route, e.g. not found
    //   if (to && !to.instances[currentName]) {
    //     to.instances[currentName] = viewRef.value
    //     // trigger enter callbacks when different routes only
    //     if (viewRef.value) {
    //       ;(to.enterCallbacks[currentName] || []).forEach(callback =>
    //         callback(viewRef.value!)
    //       )
    //       // avoid double calls since watch is called before the onVnodeMounted
    //       to.enterCallbacks[currentName] = []
    //     }
    //   }
    // })

    return () => {
      const route = props.route || injectedRoute
      const matchedRoute = matchedRouteRef.value
      const ViewComponent = matchedRoute && matchedRoute.components[props.name]
      // we need the value at the time we render because when we unmount, we
      // navigated to a different location so the value is different
      const currentName = props.name
      const key = matchedRoute && currentName + matchedRoute.path

      if (!ViewComponent) {
        return slots.default
          ? slots.default({ Component: ViewComponent, route, key })
          : null
      }

      // props from route configuration
      const routePropsOption = matchedRoute!.props[props.name]
      const routeProps = routePropsOption
        ? routePropsOption === true
          ? route.params
          : typeof routePropsOption === 'function'
          ? routePropsOption(route)
          : routePropsOption
        : null

      const onVnodeMounted = () => {
        matchedRoute!.instances[currentName] = viewRef.value
        ;(matchedRoute!.enterCallbacks[currentName] || []).forEach(callback =>
          callback(viewRef.value!)
        )
      }
      const onVnodeUnmounted = () => {
        // remove the instance reference to prevent leak
        matchedRoute!.instances[currentName] = null
      }

      const component = h(
        ViewComponent,
        assign({ key }, routeProps, attrs, {
          onVnodeMounted,
          onVnodeUnmounted,
          ref: viewRef,
        })
      )

      return (
        // pass the vnode to the slot as a prop.
        // h and <component :is="..."> both accept vnodes
        slots.default
          ? slots.default({ Component: component, route, key })
          : component
      )
    }
  },
})

// export the public type for h/tsx inference
// also to avoid inline import() in generated d.ts files
export const RouterView = (RouterViewImpl as any) as {
  new (): {
    $props: AllowedComponentProps &
      ComponentCustomProps &
      VNodeProps &
      RouterViewProps
  }
}

// warn against deprecated usage with <transition> & <keep-alive>
// due to functional component being no longer eager in Vue 3
function warnDeprecatedUsage() {
  const instance = getCurrentInstance()!
  const parentName = instance.parent && instance.parent.type.name
  if (
    parentName &&
    (parentName === 'KeepAlive' || parentName.includes('Transition'))
  ) {
    const comp = parentName === 'KeepAlive' ? 'keep-alive' : 'transition'
    warn(
      `<router-view> can no longer be used directly inside <transition> or <keep-alive>.\n` +
        `Use slot props instead:\n\n` +
        `<router-view v-slot="{ Component }">\n` +
        `  <${comp}>\n` +
        `    <component :is="Component" />\n` +
        `  </${comp}>\n` +
        `</router-view>`
    )
  }
}
