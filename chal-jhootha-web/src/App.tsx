import { Route, Switch, useLocation } from "wouter";
import { useEffect, lazy, Suspense } from 'react';

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

const Home = lazy(() => import('./pages/Home').then(module => ({ default: module.Home })));
const GameRoom = lazy(() => import('./pages/GameRoom').then(module => ({ default: module.GameRoom })));
const Auth = lazy(() => import('./pages/Auth').then(module => ({ default: module.Auth })));
const Profile = lazy(() => import('./pages/Profile').then(module => ({ default: module.Profile })));
const PublicProfile = lazy(() => import('./pages/PublicProfile').then(module => ({ default: module.PublicProfile })));

function App() {
  return (
    <Suspense fallback={<div className="page-shell flex items-center justify-center min-h-screen text-sand font-mono uppercase text-xs">Loading...</div>}>
      <ScrollToTop />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/room/:code" component={GameRoom} />
        <Route path="/auth" component={Auth} />
        <Route path="/profile" component={Profile} />
        <Route path="/players/:handle" component={PublicProfile} />
        <Route>
          <div className="page-shell flex items-center justify-center p-4 text-center">
            <section className="brutal-card w-full max-w-md p-6">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-evidence-red">Missing case file</p>
              <h1 className="mt-3 font-display text-4xl uppercase">404 not found</h1>
              <a href="/" className="brutal-btn mt-6 inline-flex items-center bg-caution-yellow text-ink">Return home</a>
            </section>
          </div>
        </Route>
      </Switch>
    </Suspense>
  );
}

export default App;
