FROM fedora:31

COPY config /root/config
COPY scripts/slave /usr/bin/ 

RUN PYTHONUNBUFFERED=1 _build && dnf clean all

VOLUME /root/workspace 
WORKDIR /root/workspace

ENTRYPOINT ["zsh"]
