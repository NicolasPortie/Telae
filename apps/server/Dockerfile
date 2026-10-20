# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY apps/server/Telae.Server.csproj apps/server/
RUN dotnet restore apps/server/Telae.Server.csproj
COPY apps/server apps/server
RUN dotnet publish apps/server/Telae.Server.csproj -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /data && chown -R app:app /data
USER app
ENV ASPNETCORE_URLS=http://+:5015 \
    Profiles__Path=/data/profiles.json
VOLUME /data
EXPOSE 5015
ENTRYPOINT ["dotnet", "Telae.Server.dll"]
