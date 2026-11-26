---
layout: page
title: pomoudying
permalink: /pomoudying/
---

<style>
  body:has(.pomoudying-fullscreen) .page-content {
    padding: 0;
  }

  body:has(.pomoudying-fullscreen) .page-content > .wrapper {
    max-width: none;
    padding: 0;
  }

  body:has(.pomoudying-fullscreen) .page-heading {
    display: none;
  }

  body:has(.pomoudying-fullscreen) .page-content article {
    margin: 0;
  }

  .pomoudying-fullscreen {
    height: calc(100vh - 4rem);
    min-height: 32rem;
  }

  .pomoudying-fullscreen iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>

<div class="pomoudying-fullscreen">
<iframe
  src="{{ '/modules/pomoudying/' | relative_url }}"
  title="Pomoudying App"
></iframe>
</div>
