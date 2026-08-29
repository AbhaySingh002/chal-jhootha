import { Route, Switch } from "wouter";
import { Home } from "./pages/Home";
import { GameRoom } from "./pages/GameRoom";
import { Auth } from "./pages/Auth";
import { Profile } from "./pages/Profile";
import { PublicProfile } from "./pages/PublicProfile";

function App() {
  return (
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
  );
}

export default App;
