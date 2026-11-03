import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { useKeyboardInset } from "../composables/useKeyboardInset";

const Host = defineComponent({
  setup() {
    useKeyboardInset();
  },
  template: "<input aria-label='field' />",
});

const root = () => document.documentElement;
const visibleHeight = () => root().style.getPropertyValue("--keyboard-visible-height");
const keyboardOpen = () => root().hasAttribute("data-keyboard-open");

let wrapper: ReturnType<typeof mount> | undefined;

function mountHost() {
  wrapper = mount(Host, { attachTo: document.body });
  return wrapper;
}

function field() {
  return wrapper!.find("input").element as HTMLInputElement;
}

function focusField() {
  field().focus();
  document.dispatchEvent(new FocusEvent("focusin"));
}

function blurField() {
  field().blur();
  document.dispatchEvent(new FocusEvent("focusout"));
}

function stubViewport(height: number, offsetTop = 0, scale = 1) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop, scale });
  vi.stubGlobal("visualViewport", viewport);
  return viewport;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  root().style.removeProperty("--keyboard-visible-height");
  delete root().dataset.keyboardOpen;
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("innerHeight", 800);
});

describe("useKeyboardInset", () => {
  it("publishes the visible height only while a text field has focus", () => {
    const viewport = stubViewport(448);
    mountHost();
    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");

    focusField();
    expect(keyboardOpen()).toBe(true);
    expect(visibleHeight()).toBe("448px");

    blurField();
    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");

    focusField();
    viewport.height = 800;
    viewport.dispatchEvent(new Event("resize"));
    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");
  });

  it("includes how far the visual viewport scrolled", () => {
    const viewport = stubViewport(400);
    mountHost();
    focusField();

    viewport.offsetTop = 50;
    viewport.dispatchEvent(new Event("scroll"));

    expect(visibleHeight()).toBe("450px");
  });

  it("ignores a pinch-zoomed visual viewport", () => {
    const viewport = stubViewport(448);
    mountHost();
    focusField();
    expect(visibleHeight()).toBe("448px");

    viewport.scale = 2;
    viewport.dispatchEvent(new Event("resize"));

    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");
  });

  it("does not open for a viewport taller than the layout viewport", () => {
    stubViewport(1200);
    mountHost();
    focusField();

    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");
  });

  it("clears the height on unmount", () => {
    stubViewport(448);
    mountHost();
    focusField();
    expect(visibleHeight()).toBe("448px");

    wrapper!.unmount();
    wrapper = undefined;

    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");
  });

  it("stays quiet where the browser has no visual viewport", () => {
    vi.stubGlobal("visualViewport", undefined);

    expect(() => mountHost()).not.toThrow();
    expect(keyboardOpen()).toBe(false);
    expect(visibleHeight()).toBe("");
  });
});
