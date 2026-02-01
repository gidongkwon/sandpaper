import { MainPageProvider } from "./main-page/model/main-page-context";
import { createMainPageState } from "./main-page/model/use-main-page-state";
import { MainPageOverlays } from "./main-page/ui/main-page-overlays";
import { MainPageWorkspace } from "./main-page/ui/main-page-workspace";
import { PerfHud } from "../widgets/perf/perf-hud";
import { Topbar } from "../widgets/topbar/topbar";

function MainPage() {
  const { context, perfHud, topbar } = createMainPageState();

  return (
    <MainPageProvider value={context}>
      <div class="app">
        <PerfHud enabled={perfHud.enabled} stats={perfHud.stats} scrollFps={perfHud.scrollFps} />

        <Topbar
          sidebarOpen={topbar.sidebarOpen}
          toggleSidebar={topbar.toggleSidebar}
          mode={topbar.mode}
          setMode={topbar.setMode}
          syncStatus={topbar.syncStatus}
          syncStateLabel={topbar.syncStateLabel}
          syncStateDetail={topbar.syncStateDetail}
          autosaveError={topbar.autosaveError}
          autosaved={topbar.autosaved}
          autosaveStamp={topbar.autosaveStamp}
          notificationsOpen={topbar.notificationsOpen}
          notificationCount={topbar.notificationCount}
          onOpenNotifications={topbar.onOpenNotifications}
          onOpenSettings={topbar.onOpenSettings}
        />

        <MainPageWorkspace />

        <MainPageOverlays />
      </div>
    </MainPageProvider>
  );
}

export default MainPage;
