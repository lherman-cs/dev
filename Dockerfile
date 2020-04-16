FROM fedora:31

COPY . /root/dev
COPY scripts/slave /usr/bin/ 

RUN curl -sf https://gobinaries.com/lherman-cs/gotopus | sh && gotopus /root/dev/config/dev/workflow.yaml

VOLUME /root/workspace 
WORKDIR /root/workspace

ENTRYPOINT ["zsh"]
