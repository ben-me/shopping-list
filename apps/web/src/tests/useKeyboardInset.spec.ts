import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { useKeyboardInset } from "../composables/useKeyboardInset";

const Host = defineComponent({
  setup() {
    useKeyboardInset();
  },
  template: "<div />",
});

const inset = () => document.documentElement.style.getPropertyValue("--keyboard-inset");

function stubViewport(height: number, offsetTop = 0) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop });
  vi.stubGlobal("visualViewport", viewport);
  return viewport;
}

afterEach(() => {
  document.documentElement.style.removeProperty("--keyboard-inset");
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("innerHeight", 800);
});

describe("useKeyboardInset", () => {
  it("publishes no inset while the keyboard is closed", () => {
    stubViewport(800);

    mount(Host);

    expect(inset()).toBe("0px");
  });

  it("publishes the height the keyboard covers", () => {
    const viewport = stubViewport(800);
    mount(Host);

    viewport.height = 448;
    viewport.dispatchEvent(new Event("resize"));

    expect(inset()).toBe("352px");
  });

  it("shrinks the inset by how far the page scrolled past the keyboard", () => {
    const viewport = stubViewport(400);
    mount(Host);

    viewport.offsetTop = 50;
    viewport.dispatchEvent(new Event("scroll"));

    expect(inset()).toBe("350px");
  });

  it("clears the inset when the keyboard goes away", () => {
    const viewport = stubViewport(448);
    mount(Host);
    expect(inset()).toBe("352px");

    viewport.height = 800;
    viewport.dispatchEvent(new Event("resize"));

    expect(inset()).toBe("0px");
  });

  it("never publishes a negative inset", () => {
    stubViewport(1200);

    mount(Host);

    expect(inset()).toBe("0px");
  });

  it("removes the inset on unmount", () => {
    stubViewport(448);

    const wrapper = mount(Host);
    expect(inset()).toBe("352px");

    wrapper.unmount();

    expect(inset()).toBe("");
  });

  it("stays quiet where the browser has no visual viewport", () => {
    vi.stubGlobal("visualViewport", undefined);

    expect(() => mount(Host)).not.toThrow();
    expect(inset()).toBe("");
  });
});
