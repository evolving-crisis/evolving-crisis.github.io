---
layout: page
title: Study Typing
permalink: /study-typing/
---

<style>
  body:has(.study-typing-fullscreen) .page-content {
    padding: 0;
  }

  body:has(.study-typing-fullscreen) .page-content > .wrapper {
    max-width: none;
    padding: 0;
  }

  body:has(.study-typing-fullscreen) .page-heading {
    display: none;
  }

  body:has(.study-typing-fullscreen) .page-content article {
    margin: 0;
  }

  .study-typing-fullscreen {
    height: calc(100vh - 4rem);
    min-height: 32rem;
  }

  .study-typing-fullscreen iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>

<div class="study-typing-fullscreen">
<iframe
  src="{{ '/modules/study-typing-app/' | relative_url }}"
  title="Study Typing App"
></iframe>
</div>
