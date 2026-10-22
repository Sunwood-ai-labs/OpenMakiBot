import { describe, expect, it } from "vitest";

import { createCustomMascotFitContext, suggestCustomMascotAnchor } from "../shared/custom-mascot-fitting.ts";
import { addOrSelectCustomMascot, createMascotProfile } from "../shared/mascot-profile.ts";
import { FACE_BOX } from "../shared/cursor-face-data.ts";
import type { PackageAgent } from "../shared/package-format.ts";
import { validateCustomMascotDefinition } from "./custom-mascot-validation.ts";
import { agentReleaseValues, mascotLookFields, partHash, releaseLook } from "./package-parts.ts";

function customProfile(name: string) {
  const outline = Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return [FACE_BOX / 2 + Math.cos(angle) * 60, FACE_BOX / 2 + Math.sin(angle) * 60] as const;
  });
  const anchor = suggestCustomMascotAnchor(createCustomMascotFitContext(outline));
  return addOrSelectCustomMascot(
    createMascotProfile(),
    validateCustomMascotDefinition({ name, outline, anchor }),
  );
}

describe("organization look stamps", () => {
  it("preserves the frozen omitted and explicit Cursor encodings", () => {
    const legacyCursorLook = {
      color: "blue",
      mascotExpression: null,
      mascotBody: null,
      avatar: null,
      crop: null,
    };

    expect(releaseLook({ color: "blue" })).toEqual(legacyCursorLook);
    const explicitCursorLook = { ...legacyCursorLook, mascotBody: "cursor" };
    const explicitCursorHash = partHash(explicitCursorLook);
    expect(releaseLook({ color: "blue", mascotBody: "cursor" })).toEqual(explicitCursorLook);
    expect(partHash(releaseLook({ color: "blue", mascotBody: "cursor" }))).toBe(explicitCursorHash);
    expect(releaseLook({ color: "blue", mascotProfile: createMascotProfile() })).toEqual(explicitCursorLook);
    expect(partHash(releaseLook({ color: "blue" }))).toBe(partHash(legacyCursorLook));

    // Release and written hashes are intentionally independent: adding an
    // imported bot with the omitted body writes its canonical Cursor profile.
    const writtenLook = { ...releaseLook({ color: "blue" }), ...mascotLookFields({ mascotProfile: createMascotProfile() }) };
    expect(partHash(writtenLook)).toBe(explicitCursorHash);
    expect(partHash(releaseLook({ color: "blue" }))).not.toBe(explicitCursorHash);

    const unchanged = { key: "lead", name: "Lead", title: "Before", appearance: { color: "blue" } } as PackageAgent;
    const first = agentReleaseValues(unchanged, new Map());
    const titleOnlyRelease = agentReleaseValues({ ...unchanged, title: "After" }, new Map());
    expect(partHash(titleOnlyRelease.look)).toBe(partHash(first.look));
    expect(partHash(titleOnlyRelease.title)).not.toBe(partHash(first.title));

    const explicit = { ...unchanged, appearance: { color: "blue", mascotBody: "cursor" } } as PackageAgent;
    const explicitTitleOnlyRelease = agentReleaseValues({ ...explicit, title: "After" }, new Map());
    expect(partHash(explicitTitleOnlyRelease.look)).toBe(explicitCursorHash);
  });

  it("stamps custom profile changes and non-default builtin bodies", () => {
    const cursor = releaseLook({ color: "blue" });
    const cat = releaseLook({ color: "blue", mascotBody: "cat" });
    const custom = releaseLook({ color: "blue", mascotProfile: customProfile("Maki") });
    const changedCustom = releaseLook({ color: "blue", mascotProfile: customProfile("Maki two") });

    expect(cat.mascotBody).toBe("cat");
    expect(partHash(cat)).not.toBe(partHash(cursor));
    expect(custom.mascotBody).toBe("cursor");
    expect(custom.mascotProfile).toMatch(/^[a-f0-9]{64}$/);
    expect(custom.mascotProfile).not.toBe(changedCustom.mascotProfile);
    expect(partHash(custom)).not.toBe(partHash(changedCustom));
  });
});
