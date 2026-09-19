(function () {
  "use strict";

  var FORMAT = "m0saic-page-skeleton";
  var VERSION = 1;
  var DEFAULT_MAX_RECTS = 600;
  var MAX_TEXT_LINES_PER_NODE = 12;
  var SAME_RECT_TOLERANCE_PX = 2;

  var SKIP_SUBTREES = {
    SCRIPT: true,
    STYLE: true,
    NOSCRIPT: true,
    TEMPLATE: true,
  };
  var REPLACED_TAGS = {
    IMG: true,
    VIDEO: true,
    CANVAS: true,
    SVG: true,
    PICTURE: true,
    EMBED: true,
    OBJECT: true,
    IFRAME: true,
  };
  var CONTROL_TAGS = {
    INPUT: true,
    TEXTAREA: true,
    SELECT: true,
    BUTTON: true,
    PROGRESS: true,
    METER: true,
  };

  function styleValue(style, camelName, cssName) {
    if (!style) return "";
    if (style[camelName] != null && style[camelName] !== "") {
      return String(style[camelName]);
    }
    if (typeof style.getPropertyValue === "function") {
      return String(style.getPropertyValue(cssName || camelName) || "");
    }
    return "";
  }

  function colorAlpha(value) {
    var color = String(value || "").trim().toLowerCase();
    if (!color || color === "transparent") return 0;

    var rgba = color.match(/^rgba?\((.*)\)$/);
    if (!rgba) return 1;

    var body = rgba[1].trim();
    var slash = body.lastIndexOf("/");
    if (slash >= 0) {
      var slashAlpha = parseFloat(body.slice(slash + 1));
      return Number.isFinite(slashAlpha) ? Math.max(0, Math.min(1, slashAlpha)) : 1;
    }

    var parts = body.split(",").map(function (part) {
      return part.trim();
    });
    if (parts.length < 4) return 1;
    var alpha = parseFloat(parts[3]);
    return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  }

  function firstRadiusToken(value) {
    var firstAxis = String(value || "").split("/")[0].trim();
    return firstAxis.split(/\s+/)[0] || "";
  }

  /**
   * Parse one computed corner radius (or an array of four corner radii).
   * Percentages are relative to the rect's shorter axis, then the result is
   * rounded and clamped to the inscribed pill/circle radius.
   */
  function parseRadius(value, width, height) {
    var minSide = Math.max(0, Math.min(Number(width) || 0, Number(height) || 0));
    var maxRadius = Math.floor(minSide / 2);
    var values = Array.isArray(value) ? value : [value];
    var largest = 0;

    values.forEach(function (entry) {
      var token = firstRadiusToken(entry);
      var match = token.match(/^(-?(?:\d+\.?\d*|\.\d+))(px|%)$/i);
      if (!match) return;
      var amount = parseFloat(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) return;
      var pixels = match[2].toLowerCase() === "%" ? (amount / 100) * minSide : amount;
      largest = Math.max(largest, pixels);
    });

    return Math.max(0, Math.min(maxRadius, Math.round(largest)));
  }

  /** Return true when computed style paints pixels of its own. */
  function isPainted(style) {
    if (colorAlpha(styleValue(style, "backgroundColor", "background-color")) > 0) {
      return true;
    }

    var backgroundImage = styleValue(style, "backgroundImage", "background-image")
      .trim()
      .toLowerCase();
    if (backgroundImage && backgroundImage !== "none") return true;

    var shadow = styleValue(style, "boxShadow", "box-shadow").trim().toLowerCase();
    if (shadow && shadow !== "none") return true;

    var sides = ["Top", "Right", "Bottom", "Left"];
    for (var i = 0; i < sides.length; i++) {
      var side = sides[i];
      var width = parseFloat(
        styleValue(style, "border" + side + "Width", "border-" + side.toLowerCase() + "-width"),
      );
      var color = styleValue(
        style,
        "border" + side + "Color",
        "border-" + side.toLowerCase() + "-color",
      );
      if (Number.isFinite(width) && width >= 1 && colorAlpha(color) > 0) return true;
    }

    var borderWidth = parseFloat(styleValue(style, "borderWidth", "border-width"));
    return (
      Number.isFinite(borderWidth) &&
      borderWidth >= 1 &&
      colorAlpha(styleValue(style, "borderColor", "border-color")) > 0
    );
  }

  /**
   * Classify an anonymous element descriptor. Unknown kinds deliberately fold
   * to "block" so future capture heuristics remain renderer-compatible.
   */
  function classify(subject) {
    var tagName = String((subject && subject.tagName) || "").toUpperCase();
    var width = Number(subject && subject.w) || 0;
    var height = Number(subject && subject.h) || 0;
    var painted = Boolean(subject && subject.painted);

    if (tagName === "HR") return "divider";
    if (
      painted &&
      ((height <= 2 && width >= 24) || (width <= 2 && height >= 24))
    ) {
      return "divider";
    }
    if (REPLACED_TAGS[tagName]) return "image";
    if (CONTROL_TAGS[tagName]) return "control";
    return "block";
  }

  function clipRect(rect, viewportWidth, viewportHeight) {
    if (!rect) return null;
    var left = Number(rect.left != null ? rect.left : rect.x);
    var top = Number(rect.top != null ? rect.top : rect.y);
    var right = Number(
      rect.right != null ? rect.right : left + Number(rect.width != null ? rect.width : rect.w),
    );
    var bottom = Number(
      rect.bottom != null
        ? rect.bottom
        : top + Number(rect.height != null ? rect.height : rect.h),
    );
    if (![left, top, right, bottom].every(Number.isFinite)) return null;

    var clippedLeft = Math.max(0, Math.min(viewportWidth, left));
    var clippedTop = Math.max(0, Math.min(viewportHeight, top));
    var clippedRight = Math.max(0, Math.min(viewportWidth, right));
    var clippedBottom = Math.max(0, Math.min(viewportHeight, bottom));
    if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

    var x0 = Math.round(clippedLeft);
    var y0 = Math.round(clippedTop);
    var x1 = Math.round(clippedRight);
    var y1 = Math.round(clippedBottom);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function sameRect(a, b, tolerance) {
    var px = tolerance == null ? SAME_RECT_TOLERANCE_PX : tolerance;
    return (
      Math.abs(a.x - b.x) <= px &&
      Math.abs(a.y - b.y) <= px &&
      Math.abs(a.x + a.w - (b.x + b.w)) <= px &&
      Math.abs(a.y + a.h - (b.y + b.h)) <= px
    );
  }

  /**
   * Drop matching emitted wrappers in favor of their nearest, more-specific
   * descendant. Internal `_id`/`_ancestorId` fields are collector bookkeeping
   * and are stripped by `buildOutput`.
   */
  function dedupSameRect(rects) {
    var clones = rects.map(function (rect) {
      var copy = {};
      Object.keys(rect).forEach(function (key) {
        copy[key] = rect[key];
      });
      return copy;
    });
    var byId = {};
    var removed = {};

    clones.forEach(function (rect) {
      if (rect._id != null) byId[rect._id] = rect;
    });

    clones.forEach(function (rect) {
      var ancestorId = rect._ancestorId;
      while (ancestorId != null) {
        var ancestor = byId[ancestorId];
        if (!ancestor || !sameRect(rect, ancestor)) break;
        removed[ancestorId] = true;
        if (!rect.r && ancestor.r) rect.r = ancestor.r;
        ancestorId = ancestor._ancestorId;
        rect._ancestorId = ancestorId;
      }
    });

    return clones.filter(function (rect) {
      return !removed[rect._id];
    });
  }

  /**
   * Deterministic keep order: shallower paint depth, larger area, top-to-bottom,
   * left-to-right, then source traversal order.
   */
  function capAndSort(rects, maxRects) {
    var cap = Number.isFinite(maxRects)
      ? Math.max(0, Math.floor(maxRects))
      : DEFAULT_MAX_RECTS;
    var ranked = rects.map(function (rect, index) {
      return { rect: rect, index: index };
    });
    ranked.sort(function (a, b) {
      var ar = a.rect;
      var br = b.rect;
      return (
        (ar.d || 0) - (br.d || 0) ||
        br.w * br.h - ar.w * ar.h ||
        ar.y - br.y ||
        ar.x - br.x ||
        br.w - ar.w ||
        br.h - ar.h ||
        a.index - b.index
      );
    });
    return {
      rects: ranked.slice(0, cap).map(function (entry) {
        return entry.rect;
      }),
      dropped: Math.max(0, ranked.length - cap),
    };
  }

  function publicRect(rect) {
    return {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      k:
        rect.k === "text" ||
        rect.k === "image" ||
        rect.k === "control" ||
        rect.k === "divider"
          ? rect.k
          : "block",
      r: Math.max(0, Math.min(Math.floor(Math.min(rect.w, rect.h) / 2), rect.r || 0)),
      d: Math.max(0, Math.floor(rect.d || 0)),
    };
  }

  /** Deduplicate, cap, normalize, and wrap anonymous geometry in schema v1. */
  function buildOutput(viewport, rects, maxRects) {
    var deduped = dedupSameRect(rects);
    var capped = capAndSort(deduped, maxRects);
    var outputViewport = {
      w: Math.max(1, Math.round(viewport.w)),
      h: Math.max(1, Math.round(viewport.h)),
    };
    if (Number.isFinite(viewport.dpr) && viewport.dpr > 0) {
      outputViewport.dpr = viewport.dpr;
    }
    return {
      format: FORMAT,
      version: VERSION,
      viewport: outputViewport,
      rects: capped.rects.map(publicRect),
      meta: { total: capped.rects.length, dropped: capped.dropped },
    };
  }

  function elementTagName(element) {
    return String((element && (element.tagName || element.nodeName)) || "").toUpperCase();
  }

  function elementChildren(element) {
    if (!element || !element.childNodes) return [];
    return Array.prototype.slice.call(element.childNodes);
  }

  /**
   * Thin DOM collector. It reads computed paint geometry only; the output never
   * includes text, URLs, values, attributes, selectors, or page identity.
   */
  function collect(documentObject, windowObject, options) {
    var viewportWidth = Math.max(1, Math.round(Number(windowObject.innerWidth) || 1));
    var viewportHeight = Math.max(1, Math.round(Number(windowObject.innerHeight) || 1));
    var getStyle =
      typeof windowObject.getComputedStyle === "function"
        ? windowObject.getComputedStyle.bind(windowObject)
        : function () {
            return {};
          };
    var candidates = [];
    var nextId = 0;

    function addCandidate(rect, kind, radius, depth, ancestorId) {
      var candidate = {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        k: kind,
        r: radius || 0,
        d: depth,
        _id: nextId++,
        _ancestorId: ancestorId,
      };
      candidates.push(candidate);
      return candidate._id;
    }

    function collectTextNode(node, depth, ancestorId) {
      if (!node || !/\S/.test(String(node.nodeValue || ""))) return;
      if (!documentObject || typeof documentObject.createRange !== "function") return;

      var range;
      try {
        range = documentObject.createRange();
        range.selectNodeContents(node);
        var lineRects = Array.prototype.slice.call(range.getClientRects() || []);
        for (var i = 0; i < Math.min(lineRects.length, MAX_TEXT_LINES_PER_NODE); i++) {
          var clipped = clipRect(lineRects[i], viewportWidth, viewportHeight);
          if (clipped) addCandidate(clipped, "text", 0, depth, ancestorId);
        }
      } catch (_error) {
        // A detached or browser-owned text node can reject Range selection.
      } finally {
        if (range && typeof range.detach === "function") range.detach();
      }
    }

    function walk(element, emittedDepth, nearestEmittedId) {
      if (!element || Number(element.nodeType) !== 1) return;
      var tagName = elementTagName(element);
      if (SKIP_SUBTREES[tagName]) return;

      var style = getStyle(element);
      var display = styleValue(style, "display", "display").trim().toLowerCase();
      var opacity = parseFloat(styleValue(style, "opacity", "opacity"));
      if (display === "none" || (Number.isFinite(opacity) && opacity < 0.05)) return;

      var visibility = styleValue(style, "visibility", "visibility").trim().toLowerCase();
      var emitsSelf = visibility !== "hidden";
      var ownId = null;
      if (
        emitsSelf &&
        element &&
        typeof element.getBoundingClientRect === "function"
      ) {
        var rect = clipRect(
          element.getBoundingClientRect(),
          viewportWidth,
          viewportHeight,
        );
        var painted = isPainted(style);
        var meaningful =
          painted || REPLACED_TAGS[tagName] || CONTROL_TAGS[tagName] || tagName === "HR";
        if (rect && meaningful) {
          var radius = parseRadius(
            [
              styleValue(style, "borderTopLeftRadius", "border-top-left-radius"),
              styleValue(style, "borderTopRightRadius", "border-top-right-radius"),
              styleValue(style, "borderBottomRightRadius", "border-bottom-right-radius"),
              styleValue(style, "borderBottomLeftRadius", "border-bottom-left-radius"),
            ],
            rect.w,
            rect.h,
          );
          ownId = addCandidate(
            rect,
            classify({ tagName: tagName, w: rect.w, h: rect.h, painted: painted }),
            radius,
            emittedDepth,
            nearestEmittedId,
          );
        }
      }

      var childDepth = emittedDepth + (ownId == null ? 0 : 1);
      var childAncestor = ownId == null ? nearestEmittedId : ownId;
      elementChildren(element).forEach(function (child) {
        var nodeType = Number(child && child.nodeType);
        if (nodeType === 3) {
          if (visibility !== "hidden") {
            collectTextNode(child, childDepth, childAncestor);
          }
        } else if (nodeType === 1) {
          walk(child, childDepth, childAncestor);
        }
      });
    }

    if (documentObject && documentObject.body) {
      walk(documentObject.body, 0, null);
    }

    return buildOutput(
      {
        w: viewportWidth,
        h: viewportHeight,
        dpr: Number(windowObject.devicePixelRatio) || undefined,
      },
      candidates,
      options && options.maxRects,
    );
  }

  function kindSummary(rects) {
    var counts = { block: 0, text: 0, image: 0, control: 0, divider: 0 };
    rects.forEach(function (rect) {
      counts[rect.k] = (counts[rect.k] || 0) + 1;
    });
    return (
      counts.text +
      " text, " +
      counts.image +
      " image, " +
      counts.control +
      " control, " +
      counts.divider +
      " divider, " +
      counts.block +
      " block"
    );
  }

  function logSummary(output, copied) {
    var suffix = copied ? "JSON copied" : "JSON logged for manual copy";
    console.log(
      "page-skeleton capture: " +
        output.rects.length +
        " rects (" +
        kindSummary(output.rects) +
        "), " +
        output.meta.dropped +
        " dropped — " +
        suffix,
    );
  }

  function run() {
    var output = collect(document, window);
    var json = JSON.stringify(output, null, 2);
    var devtoolsCopy = typeof copy === "function" ? copy : window.copy;

    if (typeof devtoolsCopy === "function") {
      try {
        devtoolsCopy(json);
        logSummary(output, true);
        return output;
      } catch (_copyError) {
        // Fall through to the standards-based clipboard API.
      }
    }

    var clipboard = window.navigator && window.navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      try {
        return Promise.resolve(clipboard.writeText(json))
          .then(function () {
            logSummary(output, true);
            return output;
          })
          .catch(function () {
            console.log(json);
            logSummary(output, false);
            return output;
          });
      } catch (_clipboardError) {
        // Fall through to console output.
      }
    }

    console.log(json);
    logSummary(output, false);
    return output;
  }

  var api = {
    parseRadius: parseRadius,
    classify: classify,
    isPainted: isPainted,
    dedupSameRect: dedupSameRect,
    capAndSort: capAndSort,
    buildOutput: buildOutput,
    collect: collect,
    run: run,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else run();
})();
