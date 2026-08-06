# Week 12 — query plans, before and after

Captured with `EXPLAIN (ANALYZE, BUFFERS)` against the benchmark dataset
(`pnpm db:seed:load`), warm cache, median of 5 runs. The demo seed is far too
small to plan realistically — Postgres sequentially scans a 6-row table no
matter how it is indexed, so every number here comes from the load seed.

**How to read these numbers.** No query on any of these paths exceeded 50 ms even
before the fix; total DB time per page was single-digit milliseconds. These are
structural defects — query count or rows-read growing with enrollment count or
with global table size — caught before they became incidents, not incidents
resolved. At this data size the query-level ratios are dominated by planning time
and vary run to run; **buffer counts and end-to-end timings are the stable
metrics**, and both are given below.

Reproduce with `pnpm db:seed:load && pnpm bench:plans`. The equivalence proofs —
that every re-shaped query returns byte-identical results to the one it replaced —
are `pnpm bench:verify`, in `scripts/benchmarks/`.

**No schema change was needed.** All three fixes are query-shape changes served
by indexes that already existed; see `docs/benchmarks/week12-perf.md` for the
reasoning and for the indexes that were measured and deliberately _not_ added.

## Dataset

| table            | rows  |
| ---------------- | ----- |
| courses          | 11    |
| enrollments      | 3204  |
| grades           | 1500  |
| lecture_progress | 19203 |
| lectures         | 246   |
| submissions      | 3200  |
| users            | 406   |

Fixture: course `Load Course 0` (401 enrollments, 401 non-DROPPED, 4 assignments).

## 1. Gradebook submissions — redundant `studentId IN (...)` removed

The 400-element `studentId` list was logically redundant — these assignments
already scope the course — and it drove the planner to the wrong index. Leading
with `studentId` pulls every submission those 400 students ever made, _across
every course_, then discards the ones from other courses (`Rows Removed by
Filter: 2800` — 7 of every 8 rows read). Planning alone cost more than execution.

Dropping the list makes `assignmentId` the driving predicate, so the existing
`submissions_assignmentId_studentId_attemptNumber_key` index is scanned on its
leading column and only this course's rows are touched. `include` → `select` on
the same query stops dragging `textContent`/`fileKey`/`status` across the wire to
compute a matrix of integers (plan `width` 199 → 56).

The removed `studentId` list was also doing one real job: excluding DROPPED
students. That now happens in memory against the enrollment set — exercised
directly in `verify-query-edge-cases.ts`, which drops a student who has a graded cell and
asserts the cell disappears while their submission still matches the query.

**Before** — 2.42 ms (planning + execution, median of 5)

```
Sort  (cost=126.82..127.45 rows=253 width=199) (actual time=0.809..0.822 rows=400 loops=1)
  Sort Key: "attemptNumber" DESC
  Sort Method: quicksort  Memory: 93kB
  Buffers: shared hit=78
  ->  Index Scan using "submissions_studentId_idx" on submissions s  (cost=0.28..116.72 rows=253 width=199) (actual time=0.255..0.746 rows=400 loops=1)
        Index Cond: ("studentId" = ANY ('{cmravlt4f0002yyz1y09cgfqa,cmshxw5l4000177z14x9i263q,cmshxw5l4000277z1izuhp4pe,cmshxw5l4000377z1qrocr70p,cmshxw5l4000477z1jbuo57de,cmshxw5l4000577z1fw0mzf3t,cmshxw5l4000677z1gqzocvmq,cmshxw5l4000777z1iitx2qvv,cmshxw5l4000877z1ljvjulf2,cmshxw5l4000977z1jd3gan8f,cmshxw5l4000a77z1iy2l1rjx,cmshxw5l4000b77z17ff4l8wc,cmshxw5l4000c77z14b9fc51q,cmshxw5l4000d77z1eent4qwh,cmshxw5l4000e77z1dmqx1d8k,cmshxw5l4000f77z1bkecwxm2,cmshxw5l4000g77z1xsna3ni9,cmshxw5l5000h77z1tuqq9wx4,cmshxw5l5000i77z1ilq7fo0l,cmshxw5l5000j77z1iu9yiye5,cmshxw5l5000k77z11zqsba90,cmshxw5l5000l77z1kn7quf23,cmshxw5l5000m77z1o0678hor,cmshxw5l5000n77z1ampsfh7g,cmshxw5l5000o77z1ypx6b3xx,cmshxw5l5000p77z1cc44u9v6,cmshxw5l5000q77z13h1n9ov6,cmshxw5l5000r77z11x35aww3,cmshxw5l5000s77z10t1qv2wt,cmshxw5l5000t77z1lz8ktxl9,cmshxw5l5000u77z1b2yxxlj2,cmshxw5l5000v77z12ur2yf6p,cmshxw5l5000w77z1zfxbk6aq,cmshxw5l5000x77z1lvf3yns6,cmshxw5l5000y77z17sl4b10b,cmshxw5l5000z77z1b121n785,cmshxw5l5001077z1lkm58dkj,cmshxw5l5001177z1qqsxmp45,cmshxw5l5001277z1a72bxpt4,cmshxw5l5001377z12d0loz5o,cmshxw5l5001477z1khkbd4mu,cmshxw5l5001577z12todik2y,cmshxw5l5001677z1o0mv2oln,cmshxw5l5001777z1rczotpn7,cmshxw5l5001877z1cho0dndg,cmshxw5l5001977z173j2wnfb,cmshxw5l5001a77z1o6hketmu,cmshxw5l5001b77z1tmtqjeqd,cmshxw5l5001c77z13qob3u5c,cmshxw5l5001d77z1o1nzx2ym,cmshxw5l5001e77z1e6vadz7f,cmshxw5l5001f77z11eneuk54,cmshxw5l5001g77z1qm0ir02z,cmshxw5l5001h77z1bt4b5qp6,cmshxw5l5001i77z1fg37ysfd,cmshxw5l5001j77z16u41ksg7,cmshxw5l5001k77z11lak60g8,cmshxw5l5001l77z1tb3uwij6,cmshxw5l6001m77z1j6iejycb,cmshxw5l6001n77z1t6ru0smb,cmshxw5l6001o77z17mkj2z8u,cmshxw5l6001p77z1nvt7no3u,cmshxw5l6001q77z1o4a0p08k,cmshxw5l6001r77z1ja1idog9,cmshxw5l6001s77z1hgjgoam5,cmshxw5l6001t77z1vh4u7gsq,cmshxw5l6001u77z12owczybk,cmshxw5l6001v77z1t30okcnf,cmshxw5l6001w77z12r23h01r,cmshxw5l6001x77z1kja2uuh5,cmshxw5l6001y77z1mcahs80a,cmshxw5l6001z77z1m2y6qbdm,cmshxw5l6002077z1my0sszac,cmshxw5l6002177z18qwgog7c,cmshxw5l6002277z1tal82cdw,cmshxw5l6002377z19v6bia37,cmshxw5l6002477z1b78wq7fx,cmshxw5l6002577z19xt2aj5h,cmshxw5l6002677z1yniu1v62,cmshxw5l6002777z1d2mv0pgo,cmshxw5l6002877z1uwirb4xc,cmshxw5l6002977z1ovoy1aas,cmshxw5l6002a77z10geshm2z,cmshxw5l6002b77z139g29eym,cmshxw5l6002c77z1nx24ppk8,cmshxw5l6002d77z1dfb2vtc0,cmshxw5l6002e77z1cj0echg5,cmshxw5l6002f77z1tb6tu8ar,cmshxw5l6002g77z192xyj9yu,cmshxw5l6002h77z17ixy1pd3,cmshxw5l6002i77z1rc66zhdw,cmshxw5l6002j77z11alvzzpi,cmshxw5l6002k77z1zf3l9mbf,cmshxw5l6002l77z1uez4tcir,cmshxw5l6002m77z1olm4czf9,cmshxw5l6002n77z1wejyamkm,cmshxw5l6002o77z13v0bxww4,cmshxw5l6002p77z1arykgqje,cmshxw5l6002q77z1w9g7ipif,cmshxw5l6002r77z12r6gwg68,cmshxw5l6002s77z1zp4yclui,cmshxw5l6002t77z1va25nhrq,cmshxw5l6002u77z1lqcxrp9u,cmshxw5l6002v77z14s0ftb6t,cmshxw5l6002w77z1ry8ky4k1,cmshxw5l6002x77z1rrcu4vbx,cmshxw5l6002y77z1a3n1n16z,cmshxw5l6002z77z11v3i7g9g,cmshxw5l6003077z1k38xt92i,cmshxw5l6003177z15n0593nx,cmshxw5l6003277z1jue0gphs,cmshxw5l6003377z1xnt4xxbh,cmshxw5l6003477z1jjs84wfu,cmshxw5l6003577z1iq0qd7s4,cmshxw5l6003677z17tx1rs9o,cmshxw5l6003777z19d50m1ee,cmshxw5l6003877z11up9fhi3,cmshxw5l6003977z1wkw0s279,cmshxw5l6003a77z1d8xmumw5,cmshxw5l6003b77z1i3rwkfhc,cmshxw5l6003c77z1ftut2byn,cmshxw5l6003d77z13wquvyz0,cmshxw5l6003e77z1j7y87zda,cmshxw5l6003f77z11jdwjdkd,cmshxw5l6003g77z1wr2d55lf,cmshxw5l6003h77z19d5z4pqg,cmshxw5l6003i77z113vpmvzd,cmshxw5l6003j77z112aks5n6,cmshxw5l6003k77z1pj95nwry,cmshxw5l6003l77z1r9nv1w8c,cmshxw5l6003m77z1ewvr273u,cmshxw5l6003n77z1wqobmc0v,cmshxw5l6003o77z1s2a1bebb,cmshxw5l6003p77z16seq5v3d,cmshxw5l6003q77z1dbjkbcos,cmshxw5l6003r77z1h6bue6i7,cmshxw5l6003s77z198lzna32,cmshxw5l6003t77z1g0g9xk3o,cmshxw5l6003u77z1j526sclr,cmshxw5l6003v77z1pgulsx8u,cmshxw5l6003w77z1dajoc26a,cmshxw5l6003x77z1p4qx5b4p,cmshxw5l6003y77z14iiyq5zm,cmshxw5l6003z77z1xgbsv8it,cmshxw5l6004077z1ohk885sd,cmshxw5l6004177z1dib9r17s,cmshxw5l6004277z13zhlr7gl,cmshxw5l6004377z1kjsan99q,cmshxw5l6004477z17qwmoztj,cmshxw5l6004577z1hdvekwu2,cmshxw5l6004677z1yhaafvkz,cmshxw5l6004777z1oioy9uep,cmshxw5l6004877z1aivwvggn,cmshxw5l6004977z1l3g36jl6,cmshxw5l6004a77z199yqlrx4,cmshxw5l6004b77z1v4o0trwt,cmshxw5l6004c77z1gkbkmswj,cmshxw5l6004d77z193aarlk2,cmshxw5l6004e77z16hyunofv,cmshxw5l6004f77z1x12zwkq2,cmshxw5l6004g77z1rhq9c1ds,cmshxw5l6004h77z1mk16d6ro,cmshxw5l6004i77z105h64pd9,cmshxw5l6004j77z15fxqx70e,cmshxw5l6004k77z1wlh97m30,cmshxw5l6004l77z1yliv5arq,cmshxw5l6004m77z1nltauls1,cmshxw5l6004n77z1d6up4d51,cmshxw5l6004o77z15vuxt3cp,cmshxw5l6004p77z1ju5be14l,cmshxw5l6004q77z1ah0vn2fy,cmshxw5l6004r77z1k7ghedxl,cmshxw5l6004s77z1gh9jbv4x,cmshxw5l6004t77z1f55gsycz,cmshxw5l6004u77z17svhvhrq,cmshxw5l7004v77z18rhdfhah,cmshxw5l7004w77z17i4o832b,cmshxw5l7004x77z16numvr7n,cmshxw5l7004y77z1itg0oko8,cmshxw5l7004z77z1zf1a1hyn,cmshxw5l7005077z15xt4u8q6,cmshxw5l7005177z18l74k9p4,cmshxw5l7005277z1teyw6k23,cmshxw5l7005377z19heit7ky,cmshxw5l7005477z12h6f5air,cmshxw5l7005577z1is4dkvel,cmshxw5l7005677z1k0gvdbjz,cmshxw5l7005777z10qk3bigu,cmshxw5l7005877z1209xr0y5,cmshxw5l7005977z1ge7dwsf9,cmshxw5l7005a77z18s9mpt8b,cmshxw5l7005b77z1brdqxm0x,cmshxw5l7005c77z15jbnfk14,cmshxw5l7005d77z1tf31qn38,cmshxw5l7005e77z16qnhcj44,cmshxw5l7005f77z1zu9tite2,cmshxw5l7005g77z1cgqu370h,cmshxw5l7005h77z1oq7cxq21,cmshxw5l7005i77z1i0skpdm5,cmshxw5l7005j77z1t8mj0ds9,cmshxw5l7005k77z1w7d8pqmg,cmshxw5l7005l77z197z1bi7f,cmshxw5l7005m77z11zyo77jh,cmshxw5l7005n77z13zmp6yk3,cmshxw5l7005o77z1jgkxboml,cmshxw5l7005p77z1axcijfd1,cmshxw5l7005q77z1lta7e1yw,cmshxw5l7005r77z1ytyt106t,cmshxw5l7005s77z1e0qkngxl,cmshxw5l7005t77z14m10l3bj,cmshxw5l7005u77z13alfwy25,cmshxw5l7005v77z1gj0e0k5s,cmshxw5l7005w77z1osx759ls,cmshxw5l7005x77z181921qe9,cmshxw5l7005y77z15auzdo7v,cmshxw5l7005z77z1mvkhfddb,cmshxw5l7006077z1cwfebn6g,cmshxw5l7006177z1t6aox89v,cmshxw5l7006277z1pscqj7bw,cmshxw5l7006377z1twa9zo46,cmshxw5l7006477z1d15vandw,cmshxw5l7006577z1suig9xm0,cmshxw5l7006677z1ck8k6kt1,cmshxw5l7006777z1sx6ly8q2,cmshxw5l7006877z15n7n816h,cmshxw5l7006977z10wawqdv6,cmshxw5l7006a77z1yx9edhuq,cmshxw5l7006b77z1gubbee9m,cmshxw5l7006c77z1x85mpinh,cmshxw5l7006d77z1nrm665bi,cmshxw5l7006e77z15hyt60fv,cmshxw5l7006f77z1jy7kuc2w,cmshxw5l7006g77z15fq1rj4l,cmshxw5l7006h77z1vrj53pyg,cmshxw5l7006i77z118a8cc5e,cmshxw5l7006j77z1d90zv55n,cmshxw5l7006k77z1p2ytgihr,cmshxw5l7006l77z16a54ssvf,cmshxw5l7006m77z1x1snb0v4,cmshxw5l7006n77z1swohe1sm,cmshxw5l7006o77z1hwhlh4g3,cmshxw5l7006p77z1d4fsflwy,cmshxw5l7006q77z1h8yf5jbm,cmshxw5l7006r77z1ec9t6h6v,cmshxw5l7006s77z1q68vyorf,cmshxw5l7006t77z1xrefyw5y,cmshxw5l7006u77z1z8o1ffoz,cmshxw5l7006v77z1x192zrba,cmshxw5l7006w77z1m73al1lf,cmshxw5l7006x77z1puh1p7kk,cmshxw5l7006y77z1l83c0adt,cmshxw5l7006z77z1u3bpfl5r,cmshxw5l7007077z1elex2okd,cmshxw5l7007177z1th9h59ie,cmshxw5l7007277z1fnj1qdmw,cmshxw5l7007377z1netnpbr9,cmshxw5l7007477z1cz5zgoht,cmshxw5l7007577z15cim3wpi,cmshxw5l7007677z15idal6n9,cmshxw5l7007777z1gabshth1,cmshxw5l7007877z1sf05d45y,cmshxw5l7007977z1nq2dncv8,cmshxw5l7007a77z1xbwmzqzd,cmshxw5l7007b77z1wx1m6k2n,cmshxw5l7007c77z159kvqrcu,cmshxw5l7007d77z12gv3d6jj,cmshxw5l7007e77z18duwkr1f,cmshxw5l7007f77z1f0t87vem,cmshxw5l7007g77z142tcab35,cmshxw5l7007h77z1jweun9jl,cmshxw5l7007i77z1971v207z,cmshxw5l7007j77z1wmdk558b,cmshxw5l7007k77z1lh82xndz,cmshxw5l7007l77z19caiha0c,cmshxw5l7007m77z196djntbn,cmshxw5l7007n77z1hr1ri90d,cmshxw5l7007o77z1l5gqi7ht,cmshxw5l7007p77z138vnmjtr,cmshxw5l7007q77z1lnbal7tx,cmshxw5l7007r77z1wkwrq69w,cmshxw5l7007s77z1hgmn251s,cmshxw5l7007t77z1n1mfkvic,cmshxw5l7007u77z1538reb1t,cmshxw5l7007v77z18241jrl8,cmshxw5l7007w77z1rjdlg4fy,cmshxw5l7007x77z1ohr1vfah,cmshxw5l7007y77z1yjqmqknj,cmshxw5l7007z77z18fwpfk5g,cmshxw5l7008077z1sz2dsygc,cmshxw5l7008177z12uk0u0sc,cmshxw5l7008277z17hmq7doy,cmshxw5l7008377z1bpv1u23b,cmshxw5l7008477z1yb5xc07v,cmshxw5l7008577z1y86htrs9,cmshxw5l7008677z1azwvyyai,cmshxw5l7008777z17o55mr7q,cmshxw5l7008877z17b1g1gt5,cmshxw5l7008977z1d9nb20id,cmshxw5l7008a77z1g3mswnjs,cmshxw5l7008b77z15ewo0dxc,cmshxw5l7008c77z1xqts87bt,cmshxw5l7008d77z14ih74r5i,cmshxw5l7008e77z1qswsl3ev,cmshxw5l7008f77z1yl4z1741,cmshxw5l7008g77z1ld6emvl9,cmshxw5l7008h77z1b459ey6l,cmshxw5l7008i77z1os0iveuc,cmshxw5l7008j77z1wt1kttjp,cmshxw5l7008k77z1kgazxegc,cmshxw5l7008l77z17nvb4gzm,cmshxw5l7008m77z1lyr8wxds,cmshxw5l7008n77z1xvmz440h,cmshxw5l7008o77z1tpqt8f5y,cmshxw5l7008p77z10k3d73mr,cmshxw5l7008q77z1uw1y9ged,cmshxw5l7008r77z1g99p0neo,cmshxw5l7008s77z1u7kln9wm,cmshxw5l7008t77z112kcs85q,cmshxw5l7008u77z1x4ns7o13,cmshxw5l7008v77z1mbcpd99t,cmshxw5l7008w77z1rqgx7lx3,cmshxw5l7008x77z1kjtssmw9,cmshxw5l7008y77z14btigevo,cmshxw5l7008z77z15bbs3ua9,cmshxw5l7009077z16wg3g6p1,cmshxw5l7009177z1tygsqtui,cmshxw5l7009277z13d40urb0,cmshxw5l7009377z1g0zopz3e,cmshxw5l7009477z1irfe52vx,cmshxw5l7009577z1h4swdbdp,cmshxw5l7009677z1c1u7jufq,cmshxw5l7009777z1vmy7xtez,cmshxw5l7009877z14bq8f41l,cmshxw5l7009977z1e9fb507u,cmshxw5l7009a77z1hwrk8zfm,cmshxw5l7009b77z19s7l204u,cmshxw5l7009c77z1w94krxm9,cmshxw5l7009d77z1ilxw862e,cmshxw5l7009e77z1r78ls2s0,cmshxw5l7009f77z1jt2xtv1j,cmshxw5l7009g77z1ud2kxwui,cmshxw5l7009h77z1l1yi3ulo,cmshxw5l7009i77z1ng5e9gry,cmshxw5l7009j77z1wpi7tj46,cmshxw5l7009k77z1ph5phtqd,cmshxw5l7009l77z1el86om95,cmshxw5l7009m77z1aqsbw5y8,cmshxw5l7009n77z1d4mifqwx,cmshxw5l7009o77z1zpc847hc,cmshxw5l7009p77z1hgzk2nuq,cmshxw5l7009q77z1bht17enn,cmshxw5l7009r77z12ferf6rs,cmshxw5l7009s77z10tjyt8t4,cmshxw5l7009t77z1m7bnty8q,cmshxw5l7009u77z1wc4zueg0,cmshxw5l8009v77z1uptrlbo0,cmshxw5l8009w77z1cn3oylru,cmshxw5l8009x77z1ga0mey3o,cmshxw5l8009y77z12mlm22py,cmshxw5l8009z77z1iuhjlene,cmshxw5l800a077z17lfqxcb7,cmshxw5l800a177z1rv7f3xc0,cmshxw5l800a277z1hrd9xtcj,cmshxw5l800a377z1dyvify0q,cmshxw5l800a477z1fgkonijk,cmshxw5l800a577z12tax8cqf,cmshxw5l800a677z1s8gqtiy2,cmshxw5l800a777z1wie3z6kx,cmshxw5l800a877z17e61ebsf,cmshxw5l800a977z1winw63ol,cmshxw5l800aa77z17b6xlodj,cmshxw5l800ab77z1872ip42w,cmshxw5l800ac77z12lr5z3ja,cmshxw5l800ad77z1w068ciio,cmshxw5l800ae77z1wintuphb,cmshxw5l800af77z1ciz04ajd,cmshxw5l800ag77z1a7z3pyb4,cmshxw5l800ah77z14ybd9rta,cmshxw5l800ai77z15asb9bb3,cmshxw5l800aj77z1w1rpmqiy,cmshxw5l800ak77z1mxvlitao,cmshxw5l800al77z1c0axs1bz,cmshxw5l800am77z1wsg99lel,cmshxw5l800an77z1wustw5f7,cmshxw5l800ao77z1x18unf97,cmshxw5l800ap77z1q2oq85ex,cmshxw5l800aq77z13ri0b9ew,cmshxw5l800ar77z138doz10h,cmshxw5l800as77z1ut5b27qs,cmshxw5l800at77z1pyjv1b5u,cmshxw5l800au77z16cfa4ejd,cmshxw5l800av77z1q3ffwwqb,cmshxw5l800aw77z1sse1mom3,cmshxw5l800ax77z1gmfbzp22,cmshxw5l800ay77z1m9j2oq41,cmshxw5l800az77z1o5z6mz2v,cmshxw5l800b077z15v32xt2i,cmshxw5l800b177z1t4vut2jz,cmshxw5l800b277z1v035uelf,cmshxw5l800b377z1hesnie7r,cmshxw5l0000077z1rs94nmkw}'::text[]))
        Filter: ("assignmentId" = ANY ('{cmshxw5pk00c477z1un4065yy,cmshxw5pk00c577z1nh7p898x,cmshxw5pk00c677z1use4o90d,cmshxw5pk00c777z1kgah4y5a}'::text[]))
        Rows Removed by Filter: 2800
        Buffers: shared hit=78
Planning Time: 1.589 ms
Execution Time: 0.852 ms
```

**After** — 0.14 ms (planning + execution, median of 5)

```
Sort  (cost=57.41..58.41 rows=400 width=56) (actual time=0.078..0.090 rows=400 loops=1)
  Sort Key: "attemptNumber" DESC
  Sort Method: quicksort  Memory: 53kB
  Buffers: shared hit=7
  ->  Index Only Scan using "submissions_assignmentId_studentId_attemptNumber_key" on submissions s  (cost=0.28..40.12 rows=400 width=56) (actual time=0.011..0.044 rows=400 loops=1)
        Index Cond: ("assignmentId" = ANY ('{cmshxw5pk00c477z1un4065yy,cmshxw5pk00c577z1nh7p898x,cmshxw5pk00c677z1use4o90d,cmshxw5pk00c777z1kgah4y5a}'::text[]))
        Heap Fetches: 0
        Buffers: shared hit=7
Planning Time: 0.031 ms
Execution Time: 0.115 ms
```

→ 2.42 ms → 0.14 ms on this run.

**Do not quote that ratio.** At this table size the query-level figure is mostly
_planning_ time, which is volatile — repeated runs of this same script produced
ratios between roughly 10× and 20× with no code change. The two numbers here that
are stable and mean something:

- **Buffers read: 78 → 7.** The old shape touched 7 of every 8 rows for nothing.
- **End-to-end `getGradebook()` through Prisma: 9.06 ms → 4.98 ms (1.8×)** for a
  401-student course, median of 10 warm runs (`verify-query-equivalence.ts`). This is the honest
  headline — it includes the enrollments, users and assignments queries that the
  fix does not touch.

## 2. Dashboard progress — 2N+2 queries collapsed to 2

Student with the most enrollments: 8 courses, so the old code
issued 18 queries and re-scanned the same lectures/sections
16 times. Below is _one_ of the 8 per-course
completed-counts, then the single grouped query that replaces all of them.

**Before — one course of 8** — 0.24 ms (planning + execution, median of 5)

```
Aggregate  (cost=96.64..96.65 rows=1 width=8) (actual time=0.070..0.070 rows=1 loops=1)
  Buffers: shared hit=11
  ->  Hash Join  (cost=10.55..96.63 rows=6 width=0) (actual time=0.061..0.069 rows=6 loops=1)
        Hash Cond: (p."lectureId" = l.id)
        Buffers: shared hit=11
        ->  Index Scan using "lecture_progress_studentId_lectureId_key" on lecture_progress p  (cost=0.41..86.25 rows=48 width=26) (actual time=0.006..0.010 rows=48 loops=1)
              Index Cond: ("studentId" = 'cmshxw5l6003r77z1h6bue6i7'::text)
              Filter: "isCompleted"
              Buffers: shared hit=5
        ->  Hash  (cost=9.77..9.77 rows=29 width=26) (actual time=0.053..0.053 rows=30 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 10kB
              Buffers: shared hit=6
              ->  Hash Join  (cost=1.60..9.77 rows=29 width=26) (actual time=0.012..0.049 rows=30 loops=1)
                    Hash Cond: (l."sectionId" = s.id)
                    Buffers: shared hit=6
                    ->  Seq Scan on lectures l  (cost=0.00..7.46 rows=246 width=52) (actual time=0.002..0.022 rows=246 loops=1)
                          Filter: "isPublished"
                          Buffers: shared hit=5
                    ->  Hash  (cost=1.54..1.54 rows=5 width=26) (actual time=0.007..0.007 rows=5 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 9kB
                          Buffers: shared hit=1
                          ->  Seq Scan on sections s  (cost=0.00..1.54 rows=5 width=26) (actual time=0.002..0.004 rows=5 loops=1)
                                Filter: ("isPublished" AND ("courseId" = 'cmshxw5n000b477z17j4xid4y'::text))
                                Rows Removed by Filter: 38
                                Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.141 ms
Execution Time: 0.092 ms
```

**After — all 8 courses in one query** — 0.28 ms (planning + execution, median of 5)

```
HashAggregate  (cost=97.69..97.79 rows=10 width=34) (actual time=0.089..0.091 rows=8 loops=1)
  Group Key: s."courseId"
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=11
  ->  Hash Join  (cost=89.21..97.47 rows=45 width=26) (actual time=0.039..0.083 rows=48 loops=1)
        Hash Cond: (l."sectionId" = s.id)
        Buffers: shared hit=11
        ->  Hash Join  (cost=86.85..94.97 rows=48 width=26) (actual time=0.022..0.059 rows=48 loops=1)
              Hash Cond: (l.id = p."lectureId")
              Buffers: shared hit=10
              ->  Seq Scan on lectures l  (cost=0.00..7.46 rows=246 width=52) (actual time=0.001..0.020 rows=246 loops=1)
                    Filter: "isPublished"
                    Buffers: shared hit=5
              ->  Hash  (cost=86.25..86.25 rows=48 width=26) (actual time=0.017..0.017 rows=48 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 11kB
                    Buffers: shared hit=5
                    ->  Index Scan using "lecture_progress_studentId_lectureId_key" on lecture_progress p  (cost=0.41..86.25 rows=48 width=26) (actual time=0.006..0.010 rows=48 loops=1)
                          Index Cond: ("studentId" = 'cmshxw5l6003r77z1h6bue6i7'::text)
                          Filter: "isCompleted"
                          Buffers: shared hit=5
        ->  Hash  (cost=1.86..1.86 rows=40 width=52) (actual time=0.015..0.015 rows=40 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 12kB
              Buffers: shared hit=1
              ->  Seq Scan on sections s  (cost=0.00..1.86 rows=40 width=52) (actual time=0.003..0.009 rows=40 loops=1)
                    Filter: ("isPublished" AND ("courseId" = ANY ('{cmshxw5n000b477z17j4xid4y,cmshxw5r600nc77z1606rdt2j,cmshxw5uk00zk77z18a1w02kl,cmshxw5xt01bs77z1oiee5kwk,cmshxw61101o077z117pawrrw,cmshxw63t020877z1uhits6ng,cmshxw66o02cg77z15ubymlei,cmshxw68x02oo77z16u8vkqvw}'::text[])))
                    Rows Removed by Filter: 3
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=12
Planning Time: 0.144 ms
Execution Time: 0.111 ms
```

→ The grouped query costs about the same as **one** of the 8 it replaces.
Measured end-to-end through Prisma (`verify-query-equivalence.ts`), not just in the planner:
**2.32 ms → 0.49 ms (4.7×)**, 18 queries → 4.

## 3. AI agreement counts — relation filter replaced with an id filter

`ai_reviews` is empty in the benchmark DB, so this defect is invisible at head.
It is an append-only table, so to measure it honestly I inserted 9 drafts per
submission (28,800 rows), ran `ANALYZE`, captured the plans, then deleted them.

Filtering through the `submission` relation puts the predicate on the _joined_
table, so no index on `ai_reviews` can prune it: cost scales with **global**
review volume, not with this assignment. The fix reuses submission ids the page
has already fetched.

Rows in `ai_reviews` for this measurement: **28800**.

**Before — relation filter** — 5.67 ms (planning + execution, median of 5)

```
HashAggregate  (cost=3074.44..3074.50 rows=4 width=44) (actual time=5.472..5.475 rows=4 loops=1)
  Group Key: r."instructorAction"
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=2693
  ->  Hash Join  (cost=87.24..3069.94 rows=900 width=4) (actual time=0.323..5.392 rows=900 loops=1)
        Hash Cond: (r."submissionId" = j0.id)
        Buffers: shared hit=2693
        ->  Seq Scan on ai_reviews r  (cost=0.00..2907.00 rows=28800 width=30) (actual time=0.254..3.484 rows=28800 loops=1)
              Buffers: shared hit=2619
        ->  Hash  (cost=85.99..85.99 rows=100 width=26) (actual time=0.061..0.061 rows=100 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 14kB
              Buffers: shared hit=74
              ->  Bitmap Heap Scan on submissions j0  (cost=9.05..85.99 rows=100 width=26) (actual time=0.021..0.050 rows=100 loops=1)
                    Recheck Cond: ("assignmentId" = 'cmshxw5pk00c477z1un4065yy'::text)
                    Heap Blocks: exact=71
                    Buffers: shared hit=74
                    ->  Bitmap Index Scan on "submissions_assignmentId_studentId_attemptNumber_key"  (cost=0.00..9.03 rows=100 width=0) (actual time=0.013..0.014 rows=100 loops=1)
                          Index Cond: ("assignmentId" = 'cmshxw5pk00c477z1un4065yy'::text)
                          Buffers: shared hit=3
Planning:
  Buffers: shared hit=14
Planning Time: 0.167 ms
Execution Time: 5.500 ms
```

**After — id filter** — 1.28 ms (planning + execution, median of 5)

```
HashAggregate  (cost=2272.38..2272.44 rows=4 width=44) (actual time=0.914..0.915 rows=4 loops=1)
  Group Key: "instructorAction"
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=2091
  ->  Bitmap Heap Scan on ai_reviews r  (cost=428.48..2267.88 rows=900 width=4) (actual time=0.586..0.843 rows=900 loops=1)
        Recheck Cond: ("submissionId" = ANY ('{cmshxw8310hu877z10l7td23m,cmshxw8310hv477z18pjzfi0v,cmshxw8310hw077z19f6x8gyd,cmshxw8320hww77z175nj5lsv,cmshxw8320hxs77z12j625310,cmshxw8320hyo77z19mms4vkd,cmshxw8320hzk77z1j69upv3m,cmshxw8320i0g77z1f6hn0u4y,cmshxw8320i1c77z1j4b9r68r,cmshxw8320i2877z1r312h0x9,cmshxw8330i3477z1kh0e8pc2,cmshxw8330i4077z10nz1p6j4,cmshxw8330i4w77z1ln6ba0hm,cmshxw8330i5s77z14nz8z7qd,cmshxw8330i6o77z17imgi3cf,cmshxw8330i7k77z1vimaxnak,cmshxw8330i8g77z1k7pl7ywk,cmshxw8330i9c77z11ebokw7s,cmshxw8330ia877z1zhhb6nuw,cmshxw8330ib477z10nbvckrz,cmshxw8330ic077z1dryu8c0d,cmshxw8340icw77z12mz4zthe,cmshxw8340ids77z1w4ccxr4r,cmshxw8340ieo77z17whu888c,cmshxw8340ifk77z1zas5rhi7,cmshxw8340igg77z1q56qgew8,cmshxw8340ihc77z13kuce4td,cmshxw8340ii877z1a27g12jz,cmshxw8340ij477z1f3c0a8qx,cmshxw8340ik077z19cfy0xa0,cmshxw8340ikw77z1bpcbb8k3,cmshxw8340ils77z1nf742gfc,cmshxw8340imo77z1ejdc4go0,cmshxw8340ink77z18rqdgjtc,cmshxw8340iog77z15efodpwh,cmshxw8350ipc77z1owwtb53a,cmshxw8350iq877z1n4apcgaj,cmshxw8350ir477z1rnf70bye,cmshxw8350is077z1lzywewbx,cmshxw8350isw77z1ybpvwszd,cmshxw8350its77z1298m0tp5,cmshxw8350iuo77z15yc9ntvk,cmshxw8350ivk77z1ts0yjmb4,cmshxw8350iwg77z1zh6zflbb,cmshxw8350ixc77z1lkcuciau,cmshxw8360iy877z1glneldj2,cmshxw8360iz477z1at46xr4j,cmshxw8360j0077z1emzxvv0n,cmshxw8360j0w77z1y53hiic8,cmshxw8360j1s77z1nxj4d44b,cmshxw8360j2o77z1mwp6m8ep,cmshxw8360j3k77z1yrekk3i9,cmshxw8360j4g77z1hxmxunb5,cmshxw8360j5c77z1rp9vpmu5,cmshxw8360j6877z1n876mz1p,cmshxw8360j7477z1i1n25qpr,cmshxw8360j8077z198hewsj8,cmshxw8360j8w77z15yc02hik,cmshxw8360j9s77z1i3504ovc,cmshxw8360jao77z15rkvgpr7,cmshxw8370jbk77z15lnp9rj7,cmshxw8370jcg77z1krl1jfhy,cmshxw8370jdc77z12nceqn4f,cmshxw88g0je877z1aq7693n4,cmshxw88g0jf477z1125oaow2,cmshxw88g0jg077z1jhsg8aqy,cmshxw88g0jgw77z1236vvud9,cmshxw88g0jhs77z114qeby4s,cmshxw88g0jio77z1j14logvk,cmshxw88h0jjk77z1klo89o8l,cmshxw88h0jkg77z1m1b98l4w,cmshxw88h0jlc77z1rd2waw14,cmshxw88h0jm877z1jrhmaxuq,cmshxw88h0jn477z1xbbi9gx1,cmshxw88h0jo077z1gnfk3wgg,cmshxw88h0jow77z13ab7ovww,cmshxw88h0jps77z188vbj8bt,cmshxw88h0jqo77z1u5bdk6t2,cmshxw88h0jrk77z1luxq2edc,cmshxw88h0jsg77z1a4wvg9in,cmshxw88h0jtc77z1fsa8nk1k,cmshxw88h0ju877z1pt61w4a1,cmshxw88h0jv477z12fexxds0,cmshxw88h0jw077z1t0glti82,cmshxw88h0jww77z15n9o93u1,cmshxw88i0jxs77z15l0o9qqb,cmshxw88i0jyo77z1h3hcc22q,cmshxw88i0jzk77z1bchyk0rr,cmshxw88i0k0g77z1604d1lrx,cmshxw88i0k1c77z1pwht5h9w,cmshxw88i0k2877z1au17if2p,cmshxw88i0k3477z1mgk0k53b,cmshxw88i0k4077z1jnersqeg,cmshxw88i0k4w77z17s9b9ry6,cmshxw88i0k5s77z1ppto56xx,cmshxw88i0k6o77z1gheqf521,cmshxw88i0k7k77z1hxsuozen,cmshxw88i0k8g77z1x33lgqeu,cmshxw88i0k9c77z13op62i51,cmshxw88i0ka877z1a7gm7eu1}'::text[]))
        Heap Blocks: exact=1791
        Buffers: shared hit=2091
        ->  Bitmap Index Scan on "ai_reviews_submissionId_createdAt_idx"  (cost=0.00..428.00 rows=900 width=0) (actual time=0.283..0.284 rows=1791 loops=1)
              Index Cond: ("submissionId" = ANY ('{cmshxw8310hu877z10l7td23m,cmshxw8310hv477z18pjzfi0v,cmshxw8310hw077z19f6x8gyd,cmshxw8320hww77z175nj5lsv,cmshxw8320hxs77z12j625310,cmshxw8320hyo77z19mms4vkd,cmshxw8320hzk77z1j69upv3m,cmshxw8320i0g77z1f6hn0u4y,cmshxw8320i1c77z1j4b9r68r,cmshxw8320i2877z1r312h0x9,cmshxw8330i3477z1kh0e8pc2,cmshxw8330i4077z10nz1p6j4,cmshxw8330i4w77z1ln6ba0hm,cmshxw8330i5s77z14nz8z7qd,cmshxw8330i6o77z17imgi3cf,cmshxw8330i7k77z1vimaxnak,cmshxw8330i8g77z1k7pl7ywk,cmshxw8330i9c77z11ebokw7s,cmshxw8330ia877z1zhhb6nuw,cmshxw8330ib477z10nbvckrz,cmshxw8330ic077z1dryu8c0d,cmshxw8340icw77z12mz4zthe,cmshxw8340ids77z1w4ccxr4r,cmshxw8340ieo77z17whu888c,cmshxw8340ifk77z1zas5rhi7,cmshxw8340igg77z1q56qgew8,cmshxw8340ihc77z13kuce4td,cmshxw8340ii877z1a27g12jz,cmshxw8340ij477z1f3c0a8qx,cmshxw8340ik077z19cfy0xa0,cmshxw8340ikw77z1bpcbb8k3,cmshxw8340ils77z1nf742gfc,cmshxw8340imo77z1ejdc4go0,cmshxw8340ink77z18rqdgjtc,cmshxw8340iog77z15efodpwh,cmshxw8350ipc77z1owwtb53a,cmshxw8350iq877z1n4apcgaj,cmshxw8350ir477z1rnf70bye,cmshxw8350is077z1lzywewbx,cmshxw8350isw77z1ybpvwszd,cmshxw8350its77z1298m0tp5,cmshxw8350iuo77z15yc9ntvk,cmshxw8350ivk77z1ts0yjmb4,cmshxw8350iwg77z1zh6zflbb,cmshxw8350ixc77z1lkcuciau,cmshxw8360iy877z1glneldj2,cmshxw8360iz477z1at46xr4j,cmshxw8360j0077z1emzxvv0n,cmshxw8360j0w77z1y53hiic8,cmshxw8360j1s77z1nxj4d44b,cmshxw8360j2o77z1mwp6m8ep,cmshxw8360j3k77z1yrekk3i9,cmshxw8360j4g77z1hxmxunb5,cmshxw8360j5c77z1rp9vpmu5,cmshxw8360j6877z1n876mz1p,cmshxw8360j7477z1i1n25qpr,cmshxw8360j8077z198hewsj8,cmshxw8360j8w77z15yc02hik,cmshxw8360j9s77z1i3504ovc,cmshxw8360jao77z15rkvgpr7,cmshxw8370jbk77z15lnp9rj7,cmshxw8370jcg77z1krl1jfhy,cmshxw8370jdc77z12nceqn4f,cmshxw88g0je877z1aq7693n4,cmshxw88g0jf477z1125oaow2,cmshxw88g0jg077z1jhsg8aqy,cmshxw88g0jgw77z1236vvud9,cmshxw88g0jhs77z114qeby4s,cmshxw88g0jio77z1j14logvk,cmshxw88h0jjk77z1klo89o8l,cmshxw88h0jkg77z1m1b98l4w,cmshxw88h0jlc77z1rd2waw14,cmshxw88h0jm877z1jrhmaxuq,cmshxw88h0jn477z1xbbi9gx1,cmshxw88h0jo077z1gnfk3wgg,cmshxw88h0jow77z13ab7ovww,cmshxw88h0jps77z188vbj8bt,cmshxw88h0jqo77z1u5bdk6t2,cmshxw88h0jrk77z1luxq2edc,cmshxw88h0jsg77z1a4wvg9in,cmshxw88h0jtc77z1fsa8nk1k,cmshxw88h0ju877z1pt61w4a1,cmshxw88h0jv477z12fexxds0,cmshxw88h0jw077z1t0glti82,cmshxw88h0jww77z15n9o93u1,cmshxw88i0jxs77z15l0o9qqb,cmshxw88i0jyo77z1h3hcc22q,cmshxw88i0jzk77z1bchyk0rr,cmshxw88i0k0g77z1604d1lrx,cmshxw88i0k1c77z1pwht5h9w,cmshxw88i0k2877z1au17if2p,cmshxw88i0k3477z1mgk0k53b,cmshxw88i0k4077z1jnersqeg,cmshxw88i0k4w77z17s9b9ry6,cmshxw88i0k5s77z1ppto56xx,cmshxw88i0k6o77z1gheqf521,cmshxw88i0k7k77z1hxsuozen,cmshxw88i0k8g77z1x33lgqeu,cmshxw88i0k9c77z13op62i51,cmshxw88i0ka877z1a7gm7eu1}'::text[]))
              Buffers: shared hit=300
Planning Time: 0.421 ms
Execution Time: 0.930 ms
```

→ **4.4× faster** at 28800 rows, and the plan is now
bounded by this assignment instead of the whole table. End-to-end through
Prisma: **3.71 ms → 1.78 ms (2.1×)**.

_Synthetic rows removed after measurement: 28800 deleted, table back to 0._
