(function() {
  var CONSENT_KEY = 'krasopis_cookie_consent';
  var consent = localStorage.getItem(CONSENT_KEY);

  function injectBanner() {
    var banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.className = 'cookie-banner';
    banner.innerHTML =
      '<div class="cookie-inner">' +
        '<p>Tento web používá cookies pro analýzu návštěvnosti (Google Analytics). ' +
        'Pomáhají nám zlepšovat naše služby. ' +
        '<a href="https://policies.google.com/technologies/cookies" target="_blank" rel="noopener">Více informací</a></p>' +
        '<div class="cookie-buttons">' +
          '<button class="cookie-btn cookie-btn-reject" id="cookie-reject">Pouze nezbytné</button>' +
          '<button class="cookie-btn cookie-btn-accept" id="cookie-accept">Přijmout vše</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        banner.classList.add('visible');
      });
    });

    document.getElementById('cookie-accept').addEventListener('click', function() {
      localStorage.setItem(CONSENT_KEY, 'accepted');
      closeBanner(banner);
      loadAnalytics();
    });

    document.getElementById('cookie-reject').addEventListener('click', function() {
      localStorage.setItem(CONSENT_KEY, 'rejected');
      closeBanner(banner);
    });
  }

  function closeBanner(banner) {
    banner.classList.remove('visible');
    setTimeout(function() { banner.remove(); }, 400);
  }

  function loadAnalytics() {
    fetch('/api/settings')
      .then(function(r) { return r.json(); })
      .then(function(s) {
        if (!s.analyticsId) return;
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + s.analyticsId;
        document.head.appendChild(script);
        script.onload = function() {
          window.dataLayer = window.dataLayer || [];
          function gtag() { window.dataLayer.push(arguments); }
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', s.analyticsId, { anonymize_ip: true });
        };
      })
      .catch(function() {});
  }

  if (consent === 'accepted') {
    loadAnalytics();
  } else if (!consent) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectBanner);
    } else {
      injectBanner();
    }
  }
})();
