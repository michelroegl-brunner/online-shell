# Student box for PowerShell exercises: the bash box + PowerShell 7.
# Same user (student, uid 1000), same home volume, same runner limits.
# bash stays available (setup/check scripts run with bash unless they
# start with a shebang, e.g. `#!/usr/bin/env pwsh`).
ARG BASE=oshell-bash:latest
FROM ${BASE}

USER root
ENV POWERSHELL_TELEMETRY_OPTOUT=1 \
    POWERSHELL_UPDATECHECK=Off \
    DOTNET_CLI_TELEMETRY_OPTOUT=1

# curl comes from the bash image (students use it too, so don't purge it).
RUN apt-get update \
 && curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/ms.deb \
 && dpkg -i /tmp/ms.deb && rm /tmp/ms.deb \
 && apt-get update \
 && apt-get install -y --no-install-recommends powershell \
 && rm -rf /var/lib/apt/lists/*

# Windows-only cmdlets (Get-Service, Get-CimInstance, Get-ComputerInfo …)
# as stand-ins with realistic fake data, so Windows-oriented exercises work.
COPY OShellWindows /opt/microsoft/powershell/7/Modules/OShellWindows
# AllUsersAllHosts profile: prompt + command log (like the bash hooks).
COPY profile.ps1 /opt/microsoft/powershell/7/profile.ps1

USER student
CMD ["sleep", "infinity"]
