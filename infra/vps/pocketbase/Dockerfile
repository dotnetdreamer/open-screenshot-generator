# PocketBase, per https://pocketbase.io/docs/going-to-production/#using-docker
#
# Built here rather than pulled, because PocketBase publishes release binaries
# and no official image. The version matches what the neighbouring stacks on the
# same box already run, so one box has one PocketBase to reason about.

FROM alpine:3.22

# Bump this and the checksum together. They are a pair: a version bump with a
# stale checksum fails the build, which is the point.
ARG PB_VERSION=0.39.9

RUN apk add --no-cache unzip ca-certificates

# --checksum, not a bare ADD. Without it the build trusts whatever that URL
# serves at build time, and this binary ends up holding every account and every
# post the feed has. With it, a swapped or truncated release fails the build
# instead of shipping. Get the value for a new version with:
#   curl -sL <the same url> | sha256sum
ADD --checksum=sha256:4c5a1aced62ebf658bfbcfeaa944c4bfa88b173dd9d598d3cab55ea63587b36b \
    https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip \
    /tmp/pb.zip

RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

EXPOSE 8090

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090"]
