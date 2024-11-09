{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { nixpkgs, flake-utils, ... } :
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        packages.default = pkgs.buildEnv {
          name = "home-packages";
          paths = with pkgs; [
            # TODO: replace with stdenv: 
            # https://discourse.nixos.org/t/how-to-set-up-a-nix-shell-with-gnu-build-toolchain-build-essential/38579/3
           
            # personal system tools
            curl
            git
            htop
            gh
            devenv

            tmux
            neovim
            fzf
            ripgrep
            fd
            jq
            yq
            go
            nodejs
          ];
        };
      }
    );
}
