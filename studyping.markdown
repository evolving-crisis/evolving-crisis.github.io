---
layout: page
title: studyping
permalink: /studyping/
---

<style>
  body:has(.studyping-fullscreen) .page-content {
    padding: 0;
  }

  body:has(.studyping-fullscreen) .page-content > .wrapper {
    max-width: none;
    padding: 0;
  }

  body:has(.studyping-fullscreen) .page-heading {
    display: none;
  }

  body:has(.studyping-fullscreen) .page-content article {
    margin: 0;
  }

  .studyping-fullscreen {
    height: calc(100vh - 4rem);
    min-height: 32rem;
  }

  .studyping-fullscreen iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>

<div class="studyping-fullscreen">
<iframe
  src="{{ '/modules/studyping/' | relative_url }}"
  title="Studyping App"
></iframe>
</div>
