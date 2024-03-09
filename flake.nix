{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.11";
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
            curl
            git
            htop
            gnumake

            tmux
            neovim
            stow
            fzf
            ripgrep
            fd
            jq
            go
          ];
        };
      }
    );
}
