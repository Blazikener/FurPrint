import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Spinner, ToastProvider } from './components/ui'
import Home from './pages/Home'

const Report = lazy(() => import('./pages/Report'))
const CaseView = lazy(() => import('./pages/CaseView'))
const Flyer = lazy(() => import('./pages/Flyer'))
const Near = lazy(() => import('./pages/Near'))

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
      {children}
    </motion.div>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <Suspense fallback={<div className="center" style={{ paddingTop: 120 }}><Spinner /></div>}>
          <AnimatePresence mode="wait" initial={false}>
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Page><Home /></Page>} />
              <Route path="/report/:kind" element={<Page><Report /></Page>} />
              <Route path="/c/:slug" element={<Page><CaseView /></Page>} />
              <Route path="/c/:slug/flyer" element={<Page><Flyer /></Page>} />
              <Route path="/near" element={<Page><Near /></Page>} />
              <Route path="*" element={<Page><div className="container stack center" style={{ paddingTop: 80 }}><h2>Page not found</h2><a href="/">Go home</a></div></Page>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </ToastProvider>
    </MotionConfig>
  )
}
