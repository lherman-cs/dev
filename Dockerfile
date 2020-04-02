FROM fedora:31

COPY config /root/config
COPY scripts /usr/bin/ 

RUN install-system-dependencies.sh && \
    install-build-dependencies.sh && \
    install-editor-dependencies.sh && \
    dnf clean all && \
    link-configs.sh && \
    setup-nvim.sh

VOLUME /root/workspace 
WORKDIR /root/workspace
