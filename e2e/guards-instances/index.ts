import { createRouter, createWebHistory } from '../../src'
import { createApp, ref, reactive, defineComponent } from 'vue'

// override existing style on dev with shorter times
if (!__CI__) {
  const transitionDuration = '0.5s'
  const styleEl = document.createElement('style')
  styleEl.innerHTML = `
.fade-enter-active,
.fade-leave-active {
  transition: opacity ${transitionDuration} ease;
}
.child-view {
  position: absolute;
  transition: all ${transitionDuration} cubic-bezier(0.55, 0, 0.1, 1);
}
`
  document.head.append(styleEl)
}

const Home = defineComponent({
  template: `
    <div>
      <h2>Home</h2>
    </div>
  `,
})

const logs = ref<string[]>([])

const state = reactive({
  enter: 0,
  update: 0,
  leave: 0,
})

const Foo = defineComponent({
  template: '<div>foo {{ enterCallback }}</div>',
  data: () => ({ key: 'Foo', enterCallback: 0 }),
  mounted() {
    console.log('mounted Foo')
  },
  beforeRouteEnter(to, from, next) {
    state.enter++
    logs.value.push(`enter ${from.path} - ${to.path}`)
    next(vm => {
      // @ts-ignore
      vm.enterCallback++
    })
  },
  beforeRouteUpdate(to, from) {
    if (!this || this.key !== 'Foo') throw new Error('no this')
    state.update++
    logs.value.push(`update ${from.path} - ${to.path}`)
  },
  beforeRouteLeave(to, from) {
    if (!this || this.key !== 'Foo') throw new Error('no this')
    state.leave++
    logs.value.push(`leave ${from.path} - ${to.path}`)
  },
})

const webHistory = createWebHistory('/' + __dirname)
const router = createRouter({
  history: webHistory,
  routes: [
    { path: '/', component: Home },
    {
      path: '/foo',
      component: Foo,
    },
    {
      path: '/f/:id',
      component: Foo,
    },
  ],
})

const app = createApp({
  template: `
    <div id="app">
      <h1>Instances</h1>
      <p>Using {{ testCase || 'default' }}</p>
      <button id="test-normal" @click="testCase = ''">Use Normal</button>
      <button id="test-keepalive" @click="testCase = 'keepalive'">Use Keep Alive</button>
      <button id="test-transition" @click="testCase = 'transition'">Use Transition</button>
      <button id="test-keyed" @click="testCase = 'keyed'">Use keyed</button>
      <button id="test-keepalivekeyed" @click="testCase = 'keepalivekeyed'">Use Keep Alive Keyed</button>
      <pre>
route: {{ $route.fullPath }}
enters: {{ state.enter }}
updates: {{ state.update }}
leaves: {{ state.leave }}
      </pre>
      <pre id="logs">{{ logs.join('\\n') }}</pre>
      <button id="resetLogs" @click="logs = []">Reset Logs</button>
      <ul>
        <li><router-link to="/">/</router-link></li>
        <li><router-link to="/foo">/foo</router-link></li>
        <li><router-link to="/f/1">/f/1</router-link></li>
        <li><router-link to="/f/2">/f/2</router-link></li>
        <li><router-link to="/f/2?bar=foo">/f/2?bar=foo</router-link></li>
        <li><router-link to="/f/2?foo=key">/f/2?foo=key</router-link></li>
      </ul>

      <template v-if="testCase === 'keepalive'">
        <router-view v-slot="{ Component }" >
          <keep-alive>
            <component :is="Component" class="view" />
          </keep-alive>
        </router-view>
      </template>
      <template v-else-if="testCase === 'transition'">
        <router-view v-slot="{ Component }" >
          <transition name="fade" mode="">
            <component :is="Component" class="view" />
          </transition>
        </router-view>
      </template>
      <template v-else-if="testCase === 'keyed'">
        <router-view :key="$route.query.foo" class="view" />
      </template>
      <template v-else-if="testCase === 'keepalivekeyed'">
        <router-view v-slot="{ Component }" >
          <keep-alive>
            <component :is="Component" :key="$route.query.foo" class="view" />
          </keep-alive>
        </router-view>
      </template>
      <template v-else>
        <router-view class="view" />
      </template>

    </div>
  `,
  setup() {
    const testCase = ref('')

    return { state, logs, testCase }
  },
})

app.use(router)

app.mount('#app')
