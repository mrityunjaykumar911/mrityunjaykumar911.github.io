-------------------------- MODULE ResumePublication --------------------------
EXTENDS TLC

VARIABLES mode, request, content, robots, tests, build, deployment

vars == <<mode, request, content, robots, tests, build, deployment>>

TypeOK ==
  /\ mode \in {"dev", "prod"}
  /\ request \in {"root", "detail", "preview"}
  /\ content \in {"base", "publicDetail", "localDetail"}
  /\ robots \in {"index", "noindex"}
  /\ tests \in {"pending", "passed", "failed"}
  /\ build \in {"absent", "ready"}
  /\ deployment \in {"absent", "live"}

Init ==
  /\ mode = "dev"
  /\ request = "root"
  /\ content = "base"
  /\ robots = "index"
  /\ tests = "pending"
  /\ build = "absent"
  /\ deployment = "absent"

OpenRoot ==
  /\ request' = "root"
  /\ content' = "base"
  /\ robots' = "index"
  /\ UNCHANGED <<mode, tests, build, deployment>>

OpenDetail ==
  /\ request' = "detail"
  /\ content' = "publicDetail"
  /\ robots' = "index"
  /\ UNCHANGED <<mode, tests, build, deployment>>

OpenPreview ==
  /\ request' = "preview"
  /\ content' = IF mode = "dev" THEN "localDetail" ELSE "publicDetail"
  /\ robots' = "noindex"
  /\ UNCHANGED <<mode, tests, build, deployment>>

EnterProduction ==
  /\ mode' = "prod"
  /\ request' = "root"
  /\ content' = "base"
  /\ robots' = "index"
  /\ UNCHANGED <<tests, build, deployment>>

ReturnToDevelopment ==
  /\ mode' = "dev"
  /\ request' = "root"
  /\ content' = "base"
  /\ robots' = "index"
  /\ UNCHANGED <<tests, build, deployment>>

PassTests ==
  /\ tests' = "passed"
  /\ UNCHANGED <<mode, request, content, robots, build, deployment>>

FailTests ==
  /\ tests' = "failed"
  /\ build' = "absent"
  /\ deployment' = "absent"
  /\ UNCHANGED <<mode, request, content, robots>>

BuildSite ==
  /\ tests = "passed"
  /\ build' = "ready"
  /\ UNCHANGED <<mode, request, content, robots, tests, deployment>>

DeploySite ==
  /\ tests = "passed"
  /\ build = "ready"
  /\ deployment' = "live"
  /\ UNCHANGED <<mode, request, content, robots, tests, build>>

SafeNext ==
  \/ OpenRoot
  \/ OpenDetail
  \/ OpenPreview
  \/ EnterProduction
  \/ ReturnToDevelopment
  \/ PassTests
  \/ FailTests
  \/ BuildSite
  \/ DeploySite

SafeSpec == Init /\ [][SafeNext]_vars

NoPrivateInProduction == mode = "prod" => content # "localDetail"
CanonicalRoutesAreIndexable == request \in {"root", "detail"} => robots = "index"
PreviewIsNoIndex == request = "preview" => robots = "noindex"
BuildRequiresValidation == build = "ready" => tests = "passed"
DeployRequiresValidatedBuild ==
  deployment = "live" => (tests = "passed" /\ build = "ready")

Safety ==
  /\ TypeOK
  /\ NoPrivateInProduction
  /\ CanonicalRoutesAreIndexable
  /\ PreviewIsNoIndex
  /\ BuildRequiresValidation
  /\ DeployRequiresValidatedBuild

LeakPrivateOverlay ==
  /\ mode' = "prod"
  /\ request' = "preview"
  /\ content' = "localDetail"
  /\ robots' = "noindex"
  /\ UNCHANGED <<tests, build, deployment>>

IndexPreview ==
  /\ request' = "preview"
  /\ content' = "publicDetail"
  /\ robots' = "index"
  /\ UNCHANGED <<mode, tests, build, deployment>>

DeployWithoutValidation ==
  /\ deployment' = "live"
  /\ UNCHANGED <<mode, request, content, robots, tests, build>>

PrivateLeakSpec == Init /\ [][SafeNext \/ LeakPrivateOverlay]_vars
IndexedPreviewSpec == Init /\ [][SafeNext \/ IndexPreview]_vars
UncheckedDeploySpec == Init /\ [][SafeNext \/ DeployWithoutValidation]_vars

=============================================================================
