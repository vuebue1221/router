// import consola from 'consola'
import {
  RouterHistory,
  NavigationCallback,
  START,
  normalizeLocation,
  HistoryLocationNormalized,
  HistoryState,
  NavigationType,
  NavigationDirection,
  NavigationInformation,
} from './common'

// TODO: implement navigation direction in listeners

// const cs = console
// const cs = consola.withTag('abstract')

export default function createMemoryHistory(): RouterHistory {
  let listeners: NavigationCallback[] = []
  // TODO: make sure this is right as the first location is nowhere so maybe this should be empty instead
  let queue: HistoryLocationNormalized[] = [START]
  let position: number = 0

  function setLocation(location: HistoryLocationNormalized) {
    position++
    if (position === queue.length) {
      // we are at the end, we can simply append a new entry
      queue.push(location)
    } else {
      // we are in the middle, we remove everything from here in the queue
      queue.splice(position)
      queue.push(location)
    }
  }

  function triggerListeners(
    to: HistoryLocationNormalized,
    from: HistoryLocationNormalized,
    {
      direction,
      distance,
    }: Pick<NavigationInformation, 'direction' | 'distance'>
  ): void {
    const info: NavigationInformation = {
      direction,
      distance,
      type: NavigationType.pop,
    }
    for (let callback of listeners) {
      callback(to, from, info)
    }
  }

  const routerHistory: RouterHistory = {
    // rewritten by Object.defineProperty
    location: START,

    replace(to) {
      const toNormalized = normalizeLocation(to)
      // remove current entry and decrement position
      queue.splice(position--, 1)
      setLocation(toNormalized)
    },

    push(to, data?: HistoryState) {
      setLocation(normalizeLocation(to))
    },

    listen(callback) {
      listeners.push(callback)
      return () => {
        const index = listeners.indexOf(callback)
        if (index > -1) listeners.splice(index, 1)
      }
    },
    destroy() {
      listeners = []
    },

    back(shouldTrigger = true) {
      this.go(-1, shouldTrigger)
    },

    forward(shouldTrigger = true) {
      this.go(1, shouldTrigger)
    },

    go(distance, shouldTrigger = true) {
      const from = this.location
      const direction: NavigationDirection =
        // we are considering distance === 0 going forward, but in abstract mode
        // using 0 for the distance doesn't make sense like it does in html5 where
        // it reloads the page
        distance < 0 ? NavigationDirection.back : NavigationDirection.forward
      position = Math.max(0, Math.min(position + distance, queue.length - 1))
      if (shouldTrigger) {
        triggerListeners(this.location, from, {
          direction,
          distance,
        })
      }
    },
  }

  Object.defineProperty(routerHistory, 'location', {
    get: () => queue[position],
  })

  return routerHistory
}
