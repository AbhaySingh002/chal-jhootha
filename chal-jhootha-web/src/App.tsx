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
        <div className="flex items-center justify-center min-h-screen bg-paper text-ink font-display text-4xl">
          404 NOT FOUND
        </div>
      </Route>
    </Switch>
  );
}

export default App;
