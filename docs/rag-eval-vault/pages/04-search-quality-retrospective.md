# 검색 품질 회고

- 사용자는 lexical/vector 구분을 알고 싶어 하지 않는다.
- 사용자는 결과가 당장 쓸모 있는지, 그리고 맞는 위치로 이동하는지를 본다.
- 결과가 이상해 보일 때는 ranking 설명보다 snippet 품질이 더 큰 문제인 경우가 많다.
- 관련 문서: [[한영 검색 용어집]], [[Incident: Provider Mismatch]], [[Incident: Rebuild Stall]].

## 관찰

- 한국어 쿼리는 token boundary가 약하면 성능이 쉽게 떨어진다.
- exact title hit는 약한 semantic neighbor보다 위로 올라와야 한다.
- snippet이 너무 짧으면 맞는 결과도 틀려 보인다.

## 대표 예시

- `재색인`
- `색인을 새로 생성한다`
- `active provider`
