'use strict';

let tab;

const translate = async id => {
  const lang = navigator.language.split('-')[0];
  translate.objects = translate.objects || await Promise.all([
    fetch('_locales/' + lang + '/messages.json').then(r => r.json()).catch(() => ({})),
    fetch('_locales/en/messages.json').then(r => r.json())
  ]);
  return translate.objects[0][id]?.message || translate.objects[1][id]?.message || id;
};

const notify = message => chrome.notifications.create({
  title: chrome.runtime.getManifest().name,
  type: 'basic',
  iconUrl: 'data/icons/48.png',
  message
});

const icon = (state, title) => {
  translate(title).then(title => chrome.action.setTitle({
    title
  }));
  chrome.action.setBadgeText({
    text: state ? '' : 'd'
  });
};

{
  const run = () => chrome.storage.local.get({
    'badge-color': '#da4537'
  }, prefs => chrome.action.setBadgeBackgroundColor({
    color: prefs['badge-color']
  }));
  chrome.runtime.onStartup.addListener(run);
  chrome.runtime.onInstalled.addListener(run);
}

const refresh = () => chrome.storage.local.get({
  'refresh-enabled': true,
  'refresh-disabled': true,
  'state': true
}, prefs => {
  if (tab && tab.url && tab.url.startsWith('http')) {
    if ((prefs.state && prefs['refresh-enabled']) || (prefs.state === false && prefs['refresh-disabled'])) {
      chrome.tabs.reload(tab.id, {
        bypassCache: true
      });
    }
  }
  tab = null;
});

async function image(url) {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const {width: w, height: h} = img;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  return ctx.getImageData(0, 0, w, h);
}

const js = {
  wildcard: host => `*://*.${host}/*`.replace(/\*\.\*/g, '*'),
  enable() {
    icon(true, 'bg_disable');

    chrome.contentSettings.javascript.clear({}, () => chrome.storage.local.get({
      blacklist: []
    }, prefs => {
      prefs.blacklist.forEach(host => chrome.contentSettings.javascript.set({
        primaryPattern: js.wildcard(host),
        setting: 'block'
      }));
      chrome.declarativeContent.onPageChanged.removeRules(undefined, async () => {
        const action = new chrome.declarativeContent.SetIcon({
          imageData: {
            16: await image('/data/icons/d/16.png'),
            32: await image('/data/icons/d/32.png')
          }
        });
        chrome.declarativeContent.onPageChanged.addRules([{
          conditions: prefs.blacklist.map(host => new chrome.declarativeContent.PageStateMatcher({
            pageUrl: {
              hostSuffix: host
            }
          })),
          actions: [action]
        }]);
      });
      setTimeout(refresh, 10);
    }));
  },
  disable() {
    icon(false, 'bg_enable');
    chrome.contentSettings.javascript.clear({}, () => {
      chrome.contentSettings.javascript.set({
        primaryPattern: '<all_urls>',
        setting: 'block'
      });
      chrome.storage.local.get({
        whitelist: []
      }, prefs => {
        prefs.whitelist.forEach(host => chrome.contentSettings.javascript.set({
          primaryPattern: js.wildcard(host),
          setting: 'allow'
        }));
        chrome.declarativeContent.onPageChanged.removeRules(undefined, async () => {
          const action = new chrome.declarativeContent.SetIcon({
            imageData: {
              16: await image('/data/icons/a/16.png'),
              32: await image('/data/icons/a/32.png')
            }
          });
          chrome.declarativeContent.onPageChanged.addRules([{
            conditions: prefs.whitelist.map(host => new chrome.declarativeContent.PageStateMatcher({
              pageUrl: {
                hostSuffix: host
              }
            })),
            actions: [action]
          }]);
        });

        setTimeout(refresh, 10);
      });
    });
  }
};

function init() {
  chrome.storage.local.get({
    state: true
  }, prefs => {
    js[prefs.state ? 'enable' : 'disable']();
  });
}
init();

chrome.storage.onChanged.addListener(prefs => {
  if (prefs.state) {
    init();
  }
  if (prefs.whitelist && !prefs.state) {
    init();
  }
  if (prefs.blacklist && !prefs.state) {
    init();
  }
  if (prefs['badge-color']) {
    chrome.action.setBadgeBackgroundColor({
      color: prefs['badge-color'].newValue
    });
  }
});
//
chrome.action.onClicked.addListener(t => {
  tab = t;
  chrome.storage.local.get({
    state: true
  }, prefs => {
    prefs.state = !prefs.state;
    chrome.storage.local.set(prefs);
  });
});
//
{
  const onStartup = async () => {
    chrome.contextMenus.create({
      id: 'open-test-page',
      title: await translate('bg_test'),
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'whitelist-toggle',
      title: await translate('bg_add_to_whitelist'),
      contexts: ['action'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });
    chrome.contextMenus.create({
      id: 'blacklist-toggle',
      title: await translate('bg_add_to_blacklist'),
      contexts: ['action'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });
  };
  chrome.runtime.onInstalled.addListener(onStartup);
  chrome.runtime.onStartup.addListener(onStartup);
}

chrome.contextMenus.onClicked.addListener((info, t) => {
  if (info.menuItemId === 'open-test-page') {
    chrome.tabs.create({
      url: 'https://webbrowsertools.com/javascript/'
    });
  }
  else if (info.menuItemId === 'whitelist-toggle' || info.menuItemId === 'blacklist-toggle') {
    if (t.url.startsWith('http')) {
      const {hostname} = new URL(t.url);
      const type = info.menuItemId.replace('-toggle', '');
      chrome.storage.local.get({
        [type]: []
      }, prefs => {
        const index = prefs[type].indexOf(hostname);
        if (index > -1) {
          prefs[type].splice(index, 1);
        }
        else {
          prefs[type].push(hostname);
        }
        notify(index > -1 ? `"${hostname}" is removed from the ${type}` : `"${hostname}" is added to the ${type}`);
        tab = t;
        chrome.storage.local.set(prefs);
      });
    }
    else {
      translate('bg_warning').then(notify);
    }
  }
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, currentWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
