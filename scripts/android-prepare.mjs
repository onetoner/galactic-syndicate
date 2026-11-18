// Passt das von `npx cap add android` erzeugte Android-Projekt an:
//  - Querformat (sensorLandscape)
//  - Vollbild/Immersive-Modus, Bildschirm bleibt an, Display-Aussparung wird mitgenutzt
//  - versionName aus package.json, versionCode aus der CI-Laufnummer
// Aufruf: node scripts/android-prepare.mjs   (nach `npx cap add android`, vor `npx cap sync android`)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const androidDir = path.join(root, 'android');
if (!existsSync(androidDir)) {
  console.error('android/ fehlt – zuerst `npx cap add android` ausführen.');
  process.exit(1);
}
const warn = (msg) => console.warn(`::warning::${msg}`);
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const cap = JSON.parse(readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const appId = cap.appId;

// ---------------------------------------------------------------- MainActivity
function findFiles(dir, pred, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) findFiles(p, pred, out);
    else if (pred(name)) out.push(p);
  }
  return out;
}
const srcMain = path.join(androidDir, 'app', 'src', 'main');
const activities = findFiles(path.join(srcMain, 'java'), (n) => /^MainActivity\.(java|kt)$/.test(n));
if (activities.length !== 1) {
  warn(`MainActivity nicht eindeutig gefunden (${activities.length}) – Vollbild-Anpassung übersprungen.`);
} else {
  const file = activities[0];
  const original = readFileSync(file, 'utf8');
  const pkgName = (original.match(/^\s*package\s+([\w.]+)/m) || [])[1] || appId;
  if (file.endsWith('.java')) {
    writeFileSync(
      file,
      `package ${pkgName};

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
`,
    );
  } else {
    writeFileSync(
      file,
      `package ${pkgName}

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val lp = window.attributes
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.attributes = lp
        }
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }
}
`,
    );
  }
  console.log(`MainActivity angepasst: ${path.relative(root, file)}`);
}

// ---------------------------------------------------------------- AndroidManifest: Querformat
const manifestPath = path.join(srcMain, 'AndroidManifest.xml');
if (existsSync(manifestPath)) {
  let xml = readFileSync(manifestPath, 'utf8');
  if (/android:screenOrientation=/.test(xml)) {
    xml = xml.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="sensorLandscape"');
    writeFileSync(manifestPath, xml);
    console.log('Manifest: screenOrientation ersetzt.');
  } else {
    const idx = xml.indexOf('MainActivity');
    const start = idx >= 0 ? xml.lastIndexOf('<activity', idx) : -1;
    if (start >= 0) {
      const at = start + '<activity'.length;
      xml = `${xml.slice(0, at)}\n            android:screenOrientation="sensorLandscape"${xml.slice(at)}`;
      writeFileSync(manifestPath, xml);
      console.log('Manifest: Querformat gesetzt.');
    } else {
      warn('MainActivity im Manifest nicht gefunden – Querformat nicht gesetzt.');
    }
  }
} else {
  warn('AndroidManifest.xml nicht gefunden.');
}

// ---------------------------------------------------------------- Version
const gradleCandidates = ['build.gradle', 'build.gradle.kts'].map((n) => path.join(androidDir, 'app', n));
const gradlePath = gradleCandidates.find((p) => existsSync(p));
if (gradlePath) {
  let g = readFileSync(gradlePath, 'utf8');
  const code = Number(process.env.GITHUB_RUN_NUMBER || process.env.VERSION_CODE || 1) || 1;
  const before = g;
  g = g.replace(/versionCode(\s*=?\s*)\d+/, `versionCode$1${code}`);
  g = g.replace(/versionName(\s*=?\s*)"[^"]*"/, `versionName$1"${pkg.version}"`);
  if (g === before) warn('versionCode/versionName in build.gradle nicht gefunden.');
  else {
    writeFileSync(gradlePath, g);
    console.log(`Version: ${pkg.version} (Code ${code}).`);
  }
} else {
  warn('app/build.gradle nicht gefunden.');
}
