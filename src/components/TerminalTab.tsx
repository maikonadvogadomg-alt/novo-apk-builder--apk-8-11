/**
 * TerminalTab â VM Terminal / TerminalX
 * Linux-style terminal with color support, free proxy, PWA auto-analysis.
 * + ConexÃ£o local via WebSocket (Termux/ttyd) com xterm.js
 */
import { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import type { FC } from "react";

const XTermConnector = lazy(() => import("./XTermConnector")) as FC<{ wsUrl: string; onClose: () => void }>;

// âââ ANSI color helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
type Color = "green" | "red" | "yellow" | "cyan" | "blue" | "magenta" | "white" | "gray" | "orange";

interface Line {
  id: number;
  parts: { text: string; color?: Color; bold?: boolean; dim?: boolean }[];
}

function c(text: string, color?: Color, bold = false): Line["parts"][0] {
  return { text, color, bold };
}

let lineId = 0;
function line(...parts: Line["parts"]): Line {
  return { id: lineId++, parts };
}
function sline(text: string, color?: Color, bold = false): Line {
  return line(c(text, color, bold));
}

// âââ Free proxy list ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const PROXIES = [
  (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function proxyFetch(url: string): Promise<string> {
  for (const p of PROXIES) {
    try {
      const r = await fetch(p(url), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      if (j && typeof j.contents === "string") return j.contents; // allorigins
      const t = await r.text().catch(() => "");
      if (t) return t;
    } catch { /* try next */ }
  }
  throw new Error("Todos os proxies falharam. Verifique a URL e sua conexÃ£o.");
}

// âââ PWA Analyzer âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
interface PWACheck {
  name: string;
  ok: boolean | "warn";
  detail: string;
}

async function analyzePWA(url: string): Promise<PWACheck[]> {
  const checks: PWACheck[] = [];

  // Fetch main page
  let html = "";
  try {
    html = await proxyFetch(url);
    checks.push({ name: "URL acessÃ­vel", ok: true, detail: `${html.length} bytes` });
  } catch (e) {
    checks.push({ name: "URL acessÃ­vel", ok: false, detail: String(e) });
    return checks;
  }

  // HTTPS check
  checks.push({
    name: "HTTPS",
    ok: url.startsWith("https://") ? true : "warn",
    detail: url.startsWith("https://") ? "OK" : "HTTP detectado â PWAs precisam de HTTPS",
  });

  // manifest.json
  const manifestHref = html.match(/rel=["']manifest["'][^>]*href=["']([^"']+)["']/)?.[1]
    || html.match(/href=["']([^"']*manifest[^"']*\.json[^"']*)["']/i)?.[1];
  if (manifestHref) {
    try {
      const mUrl = manifestHref.startsWith("http") ? manifestHref : new URL(manifestHref, url).href;
      const mJson = await proxyFetch(mUrl);
      const m = JSON.parse(mJson);
      checks.push({ name: "manifest.json", ok: true, detail: `name: "${m.name}", start_url: "${m.start_url}"` });
      checks.push({ name: "Ãcone 192Ã192", ok: m.icons?.some((i: any) => i.sizes?.includes("192x192")) ? true : "warn", detail: m.icons?.some((i: any) => i.sizes?.includes("192x192")) ? "Presente" : "Faltando â Android exige" });
      checks.push({ name: "Ãcone 512Ã512", ok: m.icons?.some((i: any) => i.sizes?.includes("512x512")) ? true : "warn", detail: m.icons?.some((i: any) => i.sizes?.includes("512x512")) ? "Presente" : "Recomendado para splash screen" });
      checks.push({ name: "display: standalone", ok: m.display === "standalone" || m.display === "fullscreen" ? true : "warn", detail: m.display || "nÃ£o definido" });
      checks.push({ name: "theme_color", ok: !!m.theme_color ? true : "warn", detail: m.theme_color || "nÃ£o definido" });
    } catch {
      checks.push({ name: "manifest.json", ok: false, detail: `href encontrado (${manifestHref}) mas nÃ£o carregou` });
    }
  } else {
    checks.push({ name: "manifest.json", ok: false, detail: "NÃ£o encontrado â obrigatÃ³rio para PWA" });
  }

  // Service Worker
  const hasSW = html.includes("serviceWorker") || html.includes("service-worker") || html.includes("sw.js");
  checks.push({ name: "Service Worker", ok: hasSW ? true : "warn", detail: hasSW ? "Registro detectado no HTML" : "NÃ£o detectado â necessÃ¡rio para offline" });

  // Viewport meta
  const hasViewport = html.includes("viewport");
  checks.push({ name: "Viewport meta", ok: hasViewport, detail: hasViewport ? "Presente" : "Faltando â layout mobile quebrado" });

  // Scripts blocking
  const blockingScripts = (html.match(/<script(?! (type="module"|async|defer))[^>]*src=/g) || []).length;
  checks.push({ name: "Scripts bloqueantes", ok: blockingScripts === 0 ? true : "warn", detail: blockingScripts > 0 ? `${blockingScripts} script(s) sem async/defer` : "Nenhum" });

  return checks;
}

// âââ Electron generator ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function genElectronPackage(appName: string, appId: string): string {
  const safe = (appName || "meu-app").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return JSON.stringify({
    name: safe,
    version: "1.0.0",
    main: "electron/main.js",
    scripts: {
      start: "electron .",
      dist: "electron-builder --linux --win --mac",
    },
    build: {
      appId: appId || `com.example.${safe}`,
      productName: appName || "Meu App",
      directories: { output: "dist-electron" },
      files: ["electron/**/*", "dist/**/*"],
      linux: { target: "AppImage" },
      win: { target: "nsis" },
      mac: { target: "dmg" },
    },
    devDependencies: {
      electron: "^33.0.0",
      "electron-builder": "^25.0.0",
    },
  }, null, 2);
}

function genElectronMain(url: string): string {
  return `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  // Carrega o app local (dist/) ou uma URL online
  const isDev = !app.isPackaged;
  if (isDev && process.env.APP_URL) {
    win.loadURL(process.env.APP_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
    // Ou para carregar URL online:
    // win.loadURL('${url || "https://meuapp.netlify.app"}');
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`;
}

// âââ Props âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
interface TerminalTabProps {
  projectReady: boolean;
  cfg: { appName: string; appId: string; versionName: string };
  files: { path: string }[];
  source: string;
  ghToken: string;
  ghUser: { login: string } | null;
  onImportUrl: (url: string) => Promise<void>;
  onExport: () => Promise<void>;
  onPagesPublish: (repoName: string) => Promise<void>;
  onPushGitHub: (repoName: string) => Promise<void>;
}

// âââ Main Component ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default function TerminalTab(props: TerminalTabProps) {
  const { projectReady, cfg, files, source, ghToken, ghUser, onImportUrl } = props;

  const [output, setOutput] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [proxyStatus, setProxyStatus] = useState<"ok" | "fail" | "unknown">("unknown");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // âââ Termux / WebSocket local ââââââââââââââââââââââââââââââââââââââââââââââââ
  const [termuxPanel, setTermuxPanel] = useState(false);
  const [termuxUrl, setTermuxUrl] = useState(() => localStorage.getItem("sk_termux_url") || "ws://localhost:7681");
  const [termuxUrlInput, setTermuxUrlInput] = useState(() => localStorage.getItem("sk_termux_url") || "ws://localhost:7681");
  const [termuxActive, setTermuxActive] = useState(false);

  const push = useCallback((...lines: Line[]) => {
    setOutput(o => [...o, ...lines]);
  }, []);

  const scroll = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // Boot message
  useEffect(() => {
    push(
      sline("ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ", "cyan"),
      sline("â  SK TerminalX â VM Terminal Pro                          â", "cyan"),
      sline("â  Proxy: allorigins Â· corsproxy Â· codetabs                â", "cyan"),
      sline("â  PWA Analyzer Â· Git Â· Capacitor Â· EAS Â· Electron         â", "cyan"),
      sline("ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ", "cyan"),
      sline(""),
      sline("Digite  help  para ver todos os comandos disponÃ­veis.", "gray"),
      sline(""),
    );
    // Quick proxy test
    fetch("https://api.allorigins.win/get?url=https://example.com", { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? setProxyStatus("ok") : setProxyStatus("fail"))
      .catch(() => setProxyStatus("fail"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => scroll(), [output, scroll]);

  // âââ Command executor ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const exec = useCallback(async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;

    // Print prompt + command
    push(line(
      c("maikon@sk-apk", "green", true),
      c(":", "white"),
      c("~", "cyan"),
      c("$ ", "white"),
      c(cmd, "white"),
    ));

    setHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);

    const [verb, ...args] = cmd.split(/\s+/);
    const arg = args.join(" ");

    setBusy(true);
    try {
      await runCommand(verb.toLowerCase(), args, arg);
    } finally {
      setBusy(false);
      scroll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, scroll, projectReady, cfg, files, source, ghToken, ghUser]);

  async function runCommand(verb: string, args: string[], arg: string) {
    // ââ help ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "help") {
      push(
        sline(""),
        sline("Comandos disponÃ­veis:", "cyan", true),
        sline(""),
        sline("  ANÃLISE", "yellow", true),
        sline("  analyze <url>      Analisa uma URL para compatibilidade PWA", "white"),
        sline("  analyze            Analisa o projeto atualmente carregado", "white"),
        sline("  proxy test         Testa conectividade dos proxies gratuitos", "white"),
        sline("  fetch <url>        Busca URL via proxy (ignora CORS)", "white"),
        sline(""),
        sline("  PROJETO", "yellow", true),
        sline("  status             Mostra status do projeto atual", "white"),
        sline("  ls [path]          Lista arquivos do projeto", "white"),
        sline("  cat <arquivo>      Mostra conteÃºdo de um arquivo", "white"),
        sline("  import <url>       Importa projeto de uma URL (ZIP ou repositÃ³rio)", "white"),
        sline(""),
        sline("  ANDROID / APK", "yellow", true),
        sline("  cap init           Gera comandos Capacitor para este projeto", "white"),
        sline("  cap sync           Mostra comando para sincronizar Capacitor", "white"),
        sline("  eas build          Dispara build EAS via GitHub Actions", "white"),
        sline("  apk local          InstruÃ§Ãµes de build local no Android Studio", "white"),
        sline(""),
        sline("  DEPLOY / PUBLICAÃÃO", "yellow", true),
        sline("  git push <repo>    Envia projeto para repositÃ³rio GitHub", "white"),
        sline("  pages deploy <repo>Publica como GitHub Pages", "white"),
        sline("  netlify            InstruÃ§Ãµes para publicar no Netlify", "white"),
        sline("  electron build     Gera projeto Electron (desktop)", "white"),
        sline("  electron main      Gera electron/main.js", "white"),
        sline(""),
        sline("  TERMINAL", "yellow", true),
        sline("  clear              Limpa o terminal", "white"),
        sline("  version            VersÃ£o do SK TerminalX", "white"),
        sline("  â / â             Navega pelo histÃ³rico de comandos", "gray"),
        sline(""),
      );
      return;
    }

    // ââ clear âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "clear") {
      setOutput([]); return;
    }

    // ââ version âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "version") {
      push(sline("SK TerminalX v3.0 â APK Builder Suite", "cyan")); return;
    }

    // ââ proxy test ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "proxy") {
      if (args[0] === "test") {
        push(sline("Testando proxies gratuitos...", "gray"));
        for (const [i, p] of PROXIES.entries()) {
          const label = ["allorigins.win", "corsproxy.io", "codetabs.com"][i];
          try {
            const r = await fetch(p("https://example.com"), { signal: AbortSignal.timeout(6000) });
            const ok = r.ok;
            push(sline(`  ${ok ? "â" : "â"} ${label} â ${ok ? "online" : "falhou"}`, ok ? "green" : "red"));
            if (ok && i === 0) setProxyStatus("ok");
          } catch {
            push(sline(`  â ${label} â timeout`, "red"));
          }
        }
        push(sline("Teste concluÃ­do.", "gray"));
      } else {
        push(sline("Use: proxy test", "yellow"));
      }
      return;
    }

    // ââ fetch <url> âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "fetch") {
      if (!arg) { push(sline("Use: fetch <url>", "yellow")); return; }
      push(sline(`Buscando via proxy: ${arg}`, "gray"));
      try {
        const content = await proxyFetch(arg);
        const preview = content.slice(0, 800);
        push(sline(`ââ resposta (${content.length} bytes) ââ`, "cyan"));
        push(sline(preview, "white"));
        if (content.length > 800) push(sline(`... (${content.length - 800} bytes adicionais)`, "gray"));
      } catch (e) {
        push(sline("Erro: " + String(e), "red"));
      }
      return;
    }

    // ââ analyze âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "analyze") {
      if (!arg && !projectReady) {
        push(sline("Nenhum projeto carregado. Use: analyze <url>", "yellow")); return;
      }
      if (!arg) {
        // Analyze loaded project
        push(sline(`Analisando projeto: ${source}`, "gray"));
        push(sline(`  Arquivos: ${files.length}`, "white"));
        const hasManifest = files.some(f => f.path.includes("manifest"));
        const hasSW = files.some(f => f.path.includes("sw.js") || f.path.includes("service-worker"));
        const hasIndex = files.some(f => f.path.endsWith("index.html"));
        const hasDist = files.some(f => f.path.includes("dist/") || f.path.includes("public/"));
        const icon192 = files.some(f => f.path.includes("192") || f.path.includes("icon"));
        [
          { label: "index.html", ok: hasIndex },
          { label: "manifest.json/webmanifest", ok: hasManifest },
          { label: "Service Worker", ok: hasSW },
          { label: "Ãcone (192px)", ok: icon192 },
          { label: "Pasta dist/public", ok: hasDist },
        ].forEach(({ label, ok }) => {
          push(sline(`  ${ok ? "â" : "â"} ${label}`, ok ? "green" : "red"));
        });
        push(sline(""));
        push(sline(hasDist ? "â Pronto para gerar APK com Capacitor." : "â  Execute 'npm run build' para gerar a pasta dist/.", hasDist ? "green" : "yellow"));
        return;
      }
      // Analyze URL
      const url = arg.startsWith("http") ? arg : `https://${arg}`;
      push(sline(`Analisando PWA: ${url}`, "gray"));
      push(sline("Buscando via proxy...", "gray"));
      try {
        const checks = await analyzePWA(url);
        push(sline(""));
        push(sline("âââ RelatÃ³rio PWA ââââââââââââââââââââââââââââââââââââââââââââ", "cyan"));
        let ok = 0, warn = 0, fail = 0;
        for (const ch of checks) {
          const icon = ch.ok === true ? "â" : ch.ok === "warn" ? "â " : "â";
          const color: Color = ch.ok === true ? "green" : ch.ok === "warn" ? "yellow" : "red";
          push(line(c(`  ${icon} `, color, true), c(`${ch.name}`, color), c(` â ${ch.detail}`, "gray")));
          if (ch.ok === true) ok++;
          else if (ch.ok === "warn") warn++;
          else fail++;
        }
        push(sline("âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ", "cyan"));
        push(line(
          c(`  ${ok} ok  `, "green", true),
          c(`${warn} avisos  `, "yellow", true),
          c(`${fail} erros`, "red", true),
        ));
        push(sline(""));
        if (fail === 0 && warn <= 2) {
          push(sline("â PWA compatÃ­vel para APK. Use 'import " + url + "' para carregar.", "green", true));
        } else if (fail === 0) {
          push(sline("â  PWA funcional com pequenas pendÃªncias. Pode gerar APK.", "yellow"));
        } else {
          push(sline("â Corrija os erros antes de gerar o APK.", "red"));
          if (!checks.find(c => c.name === "manifest.json" && c.ok === true)) {
            push(sline("  â Adicione um manifest.json com name, icons e start_url", "yellow"));
          }
          if (!checks.find(c => c.name === "Service Worker" && c.ok === true)) {
            push(sline("  â Adicione um Service Worker para suporte offline", "yellow"));
          }
        }
      } catch (e) {
        push(sline("Erro ao analisar: " + String(e), "red"));
      }
      return;
    }

    // ââ status ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "status") {
      push(sline(""));
      push(sline("âââ Status do Ambiente âââââââââââââââââââââââââââââââââââââââ", "cyan"));
      push(line(c("  Proxy:      ", "gray"), c(proxyStatus === "ok" ? "â Online" : proxyStatus === "fail" ? "â Offline" : "verificando...", proxyStatus === "ok" ? "green" : "red")));
      push(line(c("  GitHub:     ", "gray"), c(ghUser ? `â @${ghUser.login}` : "â Sem token", ghUser ? "green" : "red")));
      push(line(c("  Projeto:    ", "gray"), c(projectReady ? `â ${cfg.appName} (${files.length} arquivos)` : "â Nenhum carregado", projectReady ? "green" : "red")));
      push(line(c("  App ID:     ", "gray"), c(cfg.appId || "nÃ£o definido", cfg.appId ? "white" : "yellow")));
      push(line(c("  VersÃ£o:     ", "gray"), c(cfg.versionName || "1.0.0", "white")));
      push(sline(""));
      return;
    }

    // ââ ls ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "ls") {
      if (!projectReady) { push(sline("Nenhum projeto carregado.", "yellow")); return; }
      const prefix = args[0] || "";
      const filtered = files.filter(f => !prefix || f.path.startsWith(prefix));
      if (!filtered.length) { push(sline("Nenhum arquivo encontrado.", "yellow")); return; }
      push(sline(`${filtered.length} arquivos:`, "gray"));
      // Group by directory
      const dirs = new Set<string>();
      filtered.slice(0, 80).forEach(f => {
        const parts = f.path.split("/");
        if (parts.length > 1) dirs.add(parts[0]);
      });
      dirs.forEach(d => push(sline(`  ð ${d}/`, "cyan")));
      filtered.slice(0, 30).filter(f => !f.path.includes("/")).forEach(f => push(sline(`  ð ${f.path}`, "white")));
      if (filtered.length > 30) push(sline(`  ... e mais ${filtered.length - 30} arquivos`, "gray"));
      return;
    }

    // ââ import <url> ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "import") {
      if (!arg) { push(sline("Use: import <url>", "yellow")); return; }
      push(sline(`Importando: ${arg}`, "gray"));
      try {
        await onImportUrl(arg);
        push(sline("â Projeto importado com sucesso!", "green", true));
      } catch (e) {
        push(sline("â Erro: " + String(e), "red"));
      }
      return;
    }

    // ââ cap âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "cap") {
      const sub = args[0] || "init";
      if (sub === "init") {
        if (!projectReady) { push(sline("Carregue um projeto primeiro.", "yellow")); return; }
        push(sline(""));
        push(sline("âââ Capacitor â Comandos de InicializaÃ§Ã£o ââââââââââââââââââââ", "cyan"));
        push(sline("  Execute no diretÃ³rio do seu projeto:", "gray"));
        push(sline(""));
        push(sline(`  $ npm install @capacitor/core @capacitor/cli`, "green"));
        push(sline(`  $ npx cap init "${cfg.appName}" "${cfg.appId || "com.example.app"}"`, "green"));
        push(sline(`  $ npm install @capacitor/android`, "green"));
        push(sline(`  $ npm run build`, "green"));
        push(sline(`  $ npx cap add android`, "green"));
        push(sline(`  $ npx cap sync`, "green"));
        push(sline(`  $ npx cap open android`, "green"));
        push(sline(""));
        push(sline("  Ou use a aba ð¤ Exportar para gerar o projeto completo.", "yellow"));
      } else if (sub === "sync") {
        push(sline("  $ npm run build && npx cap sync android", "green"));
      } else {
        push(sline("  cap init  |  cap sync", "gray"));
      }
      return;
    }

    // ââ eas build âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "eas") {
      push(sline(""));
      push(sline("âââ EAS Build (Expo) via GitHub Actions ââââââââââââââââââââââ", "cyan"));
      if (!ghUser) {
        push(sline("â Token GitHub necessÃ¡rio. Configure na aba ð GitHub.", "red"));
        return;
      }
      if (!projectReady) {
        push(sline("â Carregue um projeto primeiro.", "red"));
        return;
      }
      push(sline("  Use a aba ð¤ Exportar â seÃ§Ã£o EAS Build.", "yellow"));
      push(sline("  Ou cole seu Expo token e dispare direto:", "gray"));
      push(sline(`  expo_token = expo_...`, "green"));
      push(sline(`  npx eas build --platform android --local`, "green"));
      return;
    }

    // ââ git push ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "git") {
      const sub = args[0] || "help";
      if (sub === "push") {
        const repo = args[1] || cfg.appName?.toLowerCase().replace(/\s+/g, "-") + "-app";
        if (!ghUser) {
          push(sline("â Configure seu token GitHub na aba ð GitHub.", "red")); return;
        }
        if (!projectReady) {
          push(sline("â Carregue um projeto primeiro.", "red")); return;
        }
        push(sline(`Enviando para github.com/${ghUser.login}/${repo}...`, "gray"));
        try {
          await props.onPushGitHub(repo);
          push(sline(`â Projeto enviado para: github.com/${ghUser.login}/${repo}`, "green", true));
        } catch (e) {
          push(sline("â Erro: " + String(e), "red"));
        }
      } else if (sub === "status") {
        if (!projectReady) { push(sline("Nenhum projeto carregado.", "yellow")); return; }
        push(sline(`On branch main`, "white"));
        push(sline(`${files.length} arquivo(s) prontos para commit`, "green"));
        push(sline(`GitHub: ${ghUser ? `@${ghUser.login}` : "nÃ£o conectado"}`, ghUser ? "green" : "red"));
      } else if (sub === "init") {
        const safe = (cfg.appName || "meu-app").toLowerCase().replace(/\s+/g, "-");
        push(sline("  $ git init", "green"));
        push(sline(`  $ git remote add origin https://github.com/USER/${safe}.git`, "green"));
        push(sline(`  $ git add .`, "green"));
        push(sline(`  $ git commit -m "feat: initial commit â ${cfg.appName || "projeto"}"`, "green"));
        push(sline(`  $ git push -u origin main`, "green"));
      } else {
        push(sline("  git init  |  git push <repo>  |  git status", "gray"));
      }
      return;
    }

    // ââ pages deploy ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "pages") {
      if (args[0] === "deploy") {
        const repo = args[1] || cfg.appName?.toLowerCase().replace(/\s+/g, "-") + "-pwa";
        if (!ghUser) { push(sline("â Configure seu token GitHub na aba ð GitHub.", "red")); return; }
        if (!projectReady) { push(sline("â Carregue um projeto primeiro.", "red")); return; }
        push(sline(`Publicando como GitHub Pages em ${repo}...`, "gray"));
        try {
          await props.onPagesPublish(repo);
          push(sline(`â Site publicado: https://${ghUser.login}.github.io/${repo}/`, "green", true));
        } catch (e) {
          push(sline("â Erro: " + String(e), "red"));
        }
      } else {
        push(sline("  pages deploy <nome-do-repositÃ³rio>", "gray"));
      }
      return;
    }

    // ââ netlify âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "netlify") {
      push(sline(""));
      push(sline("âââ Deploy no Netlify (gratuito) âââââââââââââââââââââââââââââ", "cyan"));
      push(sline("  1. VÃ¡ para: netlify.com/drop", "white"));
      push(sline("  2. Arraste a pasta dist/ ou o ZIP do projeto", "white"));
      push(sline("  3. Aguarde o deploy automÃ¡tico (~30s)", "white"));
      push(sline("  4. VocÃª recebe uma URL pÃºblica *.netlify.app", "white"));
      push(sline(""));
      push(sline("  Para domÃ­nio personalizado:", "gray"));
      push(sline("  Site settings â Domain management â Add custom domain", "gray"));
      return;
    }

    // ââ electron âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "electron") {
      const sub = args[0] || "build";
      if (sub === "build") {
        push(sline(""));
        push(sline("âââ Electron â Projeto Desktop ââââââââââââââââââââââââââââââââ", "cyan"));
        push(sline("  package.json gerado:", "gray"));
        push(sline(genElectronPackage(cfg.appName, cfg.appId), "white"));
        push(sline(""));
        push(sline("  Passos:", "yellow"));
        push(sline("  1. Cole este package.json na raiz do projeto", "white"));
        push(sline("  2. Crie electron/main.js (use: electron main)", "white"));
        push(sline("  3. $ npm install", "green"));
        push(sline("  4. $ npm run dist  â  gera instaladores Linux/Windows/Mac", "green"));
      } else if (sub === "main") {
        const url = source?.match(/https?:\/\/[^\s]+/)?.[0] || "";
        push(sline(""));
        push(sline("âââ electron/main.js âââââââââââââââââââââââââââââââââââââââââââ", "cyan"));
        push(sline(genElectronMain(url), "white"));
      } else {
        push(sline("  electron build  |  electron main", "gray"));
      }
      return;
    }

    // ââ apk local ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    if (verb === "apk") {
      push(sline(""));
      push(sline("âââ Build Local via Android Studio ââââââââââââââââââââââââââ", "cyan"));
      push(sline("  1. Use a aba ð¤ Exportar â Gerar Projeto Android (.zip)", "white"));
      push(sline("  2. Extraia o ZIP", "white"));
      push(sline("  3. Android Studio â File â Open â pasta android/", "white"));
      push(sline("  4. Aguarde Gradle sync (~5 min)", "white"));
      push(sline("  5. Build â Build APK(s)", "white"));
      push(sline("  6. APK em: android/app/build/outputs/apk/debug/", "white"));
      push(sline(""));
      push(sline("  Assinar para Play Store:", "yellow"));
      push(sline("  Build â Generate Signed Bundle â crie keystore .jks", "white"));
      return;
    }

    // ââ unknown âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
    push(sline(`bash: ${verb}: comando nÃ£o encontrado`, "red"));
    push(sline(`Digite 'help' para ver os comandos disponÃ­veis.`, "gray"));
  }

  // âââ Key handler ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      exec(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.min(i + 1, history.length - 1);
        setInput(history[next] ?? "");
        return next;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.max(i - 1, -1);
        setInput(next === -1 ? "" : (history[next] ?? ""));
        return next;
      });
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setOutput([]);
    }
  }

  // âââ Color map âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const colorMap: Record<Color, string> = {
    green: "#4ade80",
    red: "#f87171",
    yellow: "#fbbf24",
    cyan: "#22d3ee",
    blue: "#60a5fa",
    magenta: "#c084fc",
    white: "#f1f5f9",
    gray: "#64748b",
    orange: "#fb923c",
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: "520px" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-700/50 shrink-0">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500 opacity-80" />
          <div className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
        </div>
        <span className="text-xs text-slate-400 font-mono ml-1">sk-terminal â bash</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full inline-block ${proxyStatus === "ok" ? "bg-green-400" : proxyStatus === "fail" ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`}
            title={`Proxy: ${proxyStatus}`}
          />
          <span className="text-[10px] text-slate-500">
            {proxyStatus === "ok" ? "proxy online" : proxyStatus === "fail" ? "proxy offline" : "verificando..."}
          </span>
          <button
            onClick={() => { setTermuxPanel(p => !p); setTermuxActive(false); }}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${termuxPanel ? "border-green-500 text-green-400 bg-green-950/40" : "border-slate-600 text-slate-400 hover:border-green-500 hover:text-green-400"}`}
            title="Conectar ao Termux / servidor WebSocket local"
          >
            ð Termux
          </button>
          <button
            onClick={() => setOutput([])}
            className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded hover:bg-slate-700 transition-colors"
          >
            limpar
          </button>
        </div>
      </div>

      {/* âââ Painel de conexÃ£o Termux âââââââââââââââââââââââââââââââââââââââââââ */}
      {termuxPanel && !termuxActive && (
        <div className="bg-[#0d1117] border-b border-green-800/50 px-3 py-2.5 shrink-0">
          <p className="text-[11px] text-green-400 font-semibold mb-1.5">ð ConexÃ£o Local â Termux / ttyd</p>
          <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
            No Termux: <span className="text-yellow-300 font-mono">pkg install ttyd &amp;&amp; ttyd -p 7681 bash</span><br/>
            Depois informe o endereÃ§o WebSocket abaixo e clique em Conectar.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={termuxUrlInput}
              onChange={e => setTermuxUrlInput(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-slate-200 outline-none focus:border-green-500"
              placeholder="ws://localhost:7681"
            />
            <button
              onClick={() => {
                const url = termuxUrlInput.trim() || "ws://localhost:7681";
                localStorage.setItem("sk_termux_url", url);
                setTermuxUrl(url);
                setTermuxActive(true);
              }}
              className="text-xs px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white transition-colors font-semibold"
            >
              Conectar
            </button>
            <button
              onClick={() => setTermuxPanel(false)}
              className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 transition-colors"
            >
              â
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            ð¡ Timeout: 19 minutos Â· ReconexÃ£o automÃ¡tica Â· Funciona tambÃ©m com qualquer servidor ttyd na rede
          </p>
        </div>
      )}

      {/* âââ xterm.js (Termux ativo) âââââââââââââââââââââââââââââââââââââââââââ */}
      {termuxActive && (
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
          <Suspense fallback={
            <div className="flex-1 flex items-center justify-center bg-[#0d1117] text-slate-400 text-sm">
              Carregando terminal...
            </div>
          }>
            <XTermConnector
              wsUrl={termuxUrl}
              onClose={() => { setTermuxActive(false); setTermuxPanel(true); }}
            />
          </Suspense>
        </div>
      )}

      {/* Output (terminal simulado â visÃ­vel quando Termux nÃ£o estÃ¡ ativo) */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2 bg-[#0d1117] cursor-text font-mono text-xs leading-relaxed"
        style={{ fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace", display: termuxActive ? "none" : undefined }}
        onClick={() => inputRef.current?.focus()}
      >
        {output.map(l => (
          <div key={l.id} className="whitespace-pre-wrap break-all">
            {l.parts.map((p, i) => (
              <span
                key={i}
                style={{
                  color: p.color ? colorMap[p.color] : "#94a3b8",
                  fontWeight: p.bold ? "700" : undefined,
                  opacity: p.dim ? 0.5 : undefined,
                }}
              >
                {p.text}
              </span>
            ))}
          </div>
        ))}

        {/* Quick command chips */}
        <div className="flex flex-wrap gap-1.5 my-2">
          {["analyze", "status", "ls", "cap init", "electron build", "git status", "netlify", "help"].map(cmd => (
            <button
              key={cmd}
              onClick={() => { setInput(cmd); inputRef.current?.focus(); }}
              className="text-[10px] px-2 py-0.5 rounded border border-slate-700 text-slate-400 hover:border-cyan-600 hover:text-cyan-400 transition-colors bg-slate-900/60"
            >
              {cmd}
            </button>
          ))}
        </div>

        {/* Input line */}
        <div className="flex items-center gap-1 mt-1">
          <span style={{ color: colorMap.green, fontWeight: 700 }}>maikon@sk-apk</span>
          <span style={{ color: colorMap.white }}>:</span>
          <span style={{ color: colorMap.cyan }}>~</span>
          <span style={{ color: colorMap.white }}>$ </span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
            className="flex-1 bg-transparent outline-none text-xs"
            style={{
              color: "#f1f5f9",
              caretColor: "#4ade80",
              fontFamily: "inherit",
            }}
            placeholder={busy ? "executando..." : ""}
            autoComplete="off"
            spellCheck={false}
          />
          {busy && (
            <span className="text-[10px] text-yellow-400 animate-pulse">â</span>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Status bar â oculto quando Termux ativo */}
      {!termuxActive && (
        <div className="flex items-center gap-3 px-3 py-1 bg-[#161b22] border-t border-slate-700/50 shrink-0 text-[10px] text-slate-500">
          <span>â¨ Enter = executar Â· ââ = histÃ³rico Â· Ctrl+L = limpar Â· ð Termux = terminal real</span>
          <span className="ml-auto">
            {projectReady ? `ð± ${cfg.appName} Â· ${files.length} arquivos` : "nenhum projeto"}
          </span>
        </div>
      )}
    </div>
  );
}
