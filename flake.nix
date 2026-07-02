{
  description = "open-orchard — dev shell for OPAL website (Node + Vite/Vitest toolchain)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        node = pkgs.nodejs_22;
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            node        # provides node, npm, npx, corepack
            pkgs.git
          ];

          # npm resolves dependencies from the registry (not via Nix); this shell
          # only pins the runtime toolchain. Run ./scripts/setup.sh once to install.
          shellHook = ''
            echo ""
            echo "  🍎 opal-website dev shell"
            echo "     node $(node --version)  ·  npm $(npm --version)"
            echo ""
            echo "  setup   ./scripts/setup.sh                     # npm install"
            echo "  test    ./scripts/test.sh                      # typecheck + vitest"
            echo "  dev     npm run dev --workspace=packages/web    # OPAL dev server"
            echo "  pages   ./scripts/preview-pages.sh              # build+preview OPAL at /opal/"
            echo ""
          '';
        };
      });
}
