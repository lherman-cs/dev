{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    devenv.url = "github:cachix/devenv";
  };
  outputs = { nixpkgs, flake-utils, devenv, ... } :
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
           
            # build essentials
            bison
            flex
            fontforge
            makeWrapper
            pkg-config
            gnumake
            gcc
            libiconv
            autoconf
            automake
            libtool # freetype calls glibtoolize

            # personal system tools
            curl
            git
            htop
            gh
            devenv.packages.${system}.devenv

            tmux
            neovim
            stow
            fzf
            ripgrep
            fd
            jq
            yq
            go_1_22
            nodejs
          ];
        };
      }
    );
}
